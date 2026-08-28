import { HttpStatus, Injectable } from '@nestjs/common';
import { Job, JobEventAction, JobStatus, Prisma } from '@prisma/client';
import { ApiException } from './common';
import {
  CompanyClientService,
  RecruiterCompany,
} from './company-client.service';
import { CreateJobDto, JobDto, UpdateJobDto } from './job.dto';
import { JobEventPublisherService } from './job-event-publisher.service';
import { JobIndexingService } from './job-indexing.service';
import {
  JobAvailabilityDto,
  JobAvailabilityReason,
} from './job-availability.dto';
import { ActiveJobStatsDto } from './job-stats.dto';
import {
  BulkJobDetailResultDto,
  JobDetailDto,
} from './job-detail.dto';
import { PrismaService } from './prisma.service';

interface CommittedJobChange {
  job: Job;
  eventId: string;
}

export interface CandidateRecommendationJobAuthorization {
  jobId: string;
  companyId: string;
  recruiterId: string;
  memberRole: RecruiterCompany['memberRole'];
  aggregateVersion: number;
}

const JOB_EXPIRY_BATCH_SIZE = 100;
const BULK_DETAIL_VISIBLE_STATUSES: JobStatus[] = [
  JobStatus.PUBLISHED,
  JobStatus.CLOSED,
  JobStatus.EXPIRED,
];

@Injectable()
export class JobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyClientService,
    private readonly indexing: JobIndexingService,
    private readonly events: JobEventPublisherService,
  ) {}

  isCandidateRecommendationCompanyConfigured(): boolean {
    return this.companies.isRecommendationConfigured();
  }

  async create(
    recruiterId: string,
    authorization: string,
    dto: CreateJobDto,
  ): Promise<JobDto> {
    const company = await this.companies.getRecruiterCompany(
      recruiterId,
      authorization,
    );
    if (company.verifiedStatus !== 'VERIFIED') {
      throw new ApiException(
        'COMPANY_NOT_VERIFIED',
        'Only members of a VERIFIED company can create jobs',
        HttpStatus.FORBIDDEN,
        { verifiedStatus: company.verifiedStatus },
      );
    }
    const data = this.validateAndMap(dto);
    const job = await this.commitChange(
      JobEventAction.CREATED,
      (transaction) => transaction.job.create({
        data: {
          ...data,
          companyId: company.companyId,
          createdBy: recruiterId,
          status: JobStatus.DRAFT,
          aggregateVersion: 1,
        },
      }),
    );
    return this.toDto(job);
  }

  async listManaged(
    recruiterId: string,
    authorization: string,
  ): Promise<JobDto[]> {
    const company = await this.companies.getRecruiterCompany(
      recruiterId,
      authorization,
    );
    const jobs = await this.prisma.job.findMany({
      where: {
        companyId: company.companyId,
        ...(company.memberRole === 'MEMBER'
          ? { createdBy: recruiterId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map((job) => this.toDto(job));
  }

  async authorizeCandidateRecommendation(
    recruiterId: string,
    authorization: string,
    jobId: string,
    now = new Date(),
  ): Promise<CandidateRecommendationJobAuthorization> {
    const company = await this.companies
      .getRecruiterCompanyForRecommendation(recruiterId, authorization);
    if (company.verifiedStatus !== 'VERIFIED') {
      throw new ApiException(
        'COMPANY_NOT_VERIFIED',
        'Candidate recommendations require a VERIFIED company',
        HttpStatus.FORBIDDEN,
        { verifiedStatus: company.verifiedStatus },
      );
    }
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    this.requireManagePermission(job, company, recruiterId);
    if (this.availabilityReason(job, now) !== null) {
      throw new ApiException(
        'JOB_NOT_RECOMMENDABLE',
        'Candidate recommendations require a current PUBLISHED job',
        HttpStatus.CONFLICT,
      );
    }
    return {
      jobId: job.id,
      companyId: job.companyId,
      recruiterId,
      memberRole: company.memberRole,
      aggregateVersion: job.aggregateVersion,
    };
  }

  async revalidateCandidateRecommendation(
    context: CandidateRecommendationJobAuthorization,
    bearer: string,
    now?: Date,
  ): Promise<void> {
    let company: RecruiterCompany;
    try {
      company = await this.companies
        .getRecruiterCompanyForRecommendation(context.recruiterId, bearer);
    } catch (error) {
      if (error instanceof ApiException && error.code === 'COMPANY_NOT_FOUND') {
        throw this.candidateRecommendationContextStale();
      }
      throw error;
    }
    if (
      company.companyId !== context.companyId ||
      company.verifiedStatus !== 'VERIFIED' ||
      company.memberRole !== context.memberRole
    ) {
      throw this.candidateRecommendationContextStale();
    }
    const today = new Date(now ?? new Date());
    today.setUTCHours(0, 0, 0, 0);
    const current = await this.prisma.job.findFirst({
      where: {
        id: context.jobId,
        companyId: context.companyId,
        aggregateVersion: context.aggregateVersion,
        status: JobStatus.PUBLISHED,
        deadline: { gte: today },
        ...(company.memberRole === 'MEMBER'
          ? { createdBy: context.recruiterId }
          : {}),
      },
      select: { id: true },
    });
    if (!current) {
      throw this.candidateRecommendationContextStale();
    }
  }

  async getPublic(jobId: string): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, status: JobStatus.PUBLISHED },
    });
    if (!job) {
      throw new ApiException(
        'JOB_NOT_FOUND',
        'Published job was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...this.toDto(job),
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
    };
  }

  async getAvailability(jobId: string): Promise<JobAvailabilityDto> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      return {
        jobId,
        exists: false,
        acceptingApplications: false,
        reason: JobAvailabilityReason.NOT_FOUND,
        companyId: null,
        recruiterId: null,
        jobTitle: null,
        status: null,
        deadline: null,
      };
    }

    const reason = this.availabilityReason(job, new Date());

    return {
      jobId: job.id,
      exists: true,
      acceptingApplications: reason === null,
      reason,
      companyId: job.companyId,
      recruiterId: job.createdBy,
      jobTitle: job.title,
      status: job.status,
      deadline: job.deadline.toISOString().slice(0, 10),
    };
  }

  async getBulkDetails(
    jobIds: string[],
    now = new Date(),
  ): Promise<BulkJobDetailResultDto> {
    if (!jobIds.length) return { items: [], unavailableJobIds: [] };
    const jobs = await this.prisma.job.findMany({
      where: {
        id: { in: jobIds },
        status: { in: BULK_DETAIL_VISIBLE_STATUSES },
      },
    });
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const items: JobDetailDto[] = [];
    const unavailableJobIds: string[] = [];
    for (const jobId of jobIds) {
      const job = jobsById.get(jobId);
      if (job) items.push(this.toJobDetail(job, now));
      else unavailableJobIds.push(jobId);
    }
    return { items, unavailableJobIds };
  }

  async getActiveJobStats(
    companyId: string,
    now = new Date(),
  ): Promise<ActiveJobStatsDto> {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const activeJobCount = await this.prisma.job.count({
      where: {
        companyId,
        status: JobStatus.PUBLISHED,
        deadline: { gte: today },
      },
    });
    return { companyId, activeJobCount };
  }


  async listPending(): Promise<JobDto[]> {
    const jobs = await this.prisma.job.findMany({
      where: { status: JobStatus.PENDING_APPROVAL },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    return jobs.map((job) => this.toDto(job));
  }

  async update(
    recruiterId: string,
    authorization: string,
    jobId: string,
    dto: UpdateJobDto,
  ): Promise<JobDto> {
    if (!Object.keys(dto).length) {
      throw new ApiException(
        'EMPTY_UPDATE',
        'At least one job field must be provided',
        HttpStatus.BAD_REQUEST,
      );
    }
    const company = await this.companies.getRecruiterCompany(
      recruiterId,
      authorization,
    );
    const current = await this.prisma.job.findUnique({
      where: { id: jobId },
    });
    this.requireManagePermission(current, company, recruiterId);
    if (
      current.status === JobStatus.CLOSED ||
      current.status === JobStatus.EXPIRED
    ) {
      throw new ApiException(
        'JOB_NOT_EDITABLE',
        'CLOSED or EXPIRED jobs cannot be edited',
        HttpStatus.CONFLICT,
      );
    }

    const merged: CreateJobDto = {
      title: dto.title ?? current.title,
      description: dto.description ?? current.description,
      requirements: dto.requirements ?? current.requirements,
      benefits: dto.benefits ?? current.benefits,
      salaryMin: dto.isNegotiable === true
        ? undefined
        : (dto.salaryMin ?? current.salaryMin?.toNumber()),
      salaryMax: dto.isNegotiable === true
        ? undefined
        : (dto.salaryMax ?? current.salaryMax?.toNumber()),
      isNegotiable: dto.isNegotiable ?? current.isNegotiable,
      currency: dto.currency ?? current.currency,
      location: dto.location ?? current.location,
      jobType: dto.jobType ?? current.jobType,
      experienceYears:
        dto.experienceYears ?? current.experienceYears,
      quantity: dto.quantity ?? current.quantity,
      skills: dto.skills ?? current.skills,
      deadline:
        dto.deadline ?? current.deadline.toISOString().slice(0, 10),
    };
    const data: Prisma.JobUpdateManyMutationInput = this.validateAndMap(merged);
    const criticalChanged = [
      'title',
      'description',
      'requirements',
      'salaryMin',
      'salaryMax',
      'isNegotiable',
    ].some((field) => dto[field as keyof UpdateJobDto] !== undefined);
    if (
      current.status === JobStatus.PUBLISHED &&
      criticalChanged
    ) {
      data.status = JobStatus.PENDING_APPROVAL;
      data.publishedAt = null;
      data.rejectionReason = null;
      data.reviewedBy = null;
      data.reviewedAt = null;
    }

    const updated = await this.commitChange(
      JobEventAction.UPDATED,
      async (transaction) => {
        const result = await transaction.job.updateMany({
          where: {
            id: jobId,
            aggregateVersion: current.aggregateVersion,
          },
          data: {
            ...data,
            aggregateVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          throw new ApiException(
            'JOB_STATE_CHANGED',
            'Job changed during this request; please retry',
            HttpStatus.CONFLICT,
          );
        }
        return this.requireJob(jobId, transaction);
      },
    );
    return this.toDto(updated);
  }

  async publish(
    recruiterId: string,
    authorization: string,
    jobId: string,
  ): Promise<JobDto> {
    const company = await this.companies.getRecruiterCompany(
      recruiterId,
      authorization,
    );
    if (company.verifiedStatus !== 'VERIFIED') {
      throw new ApiException(
        'COMPANY_NOT_VERIFIED',
        'Only members of a VERIFIED company can publish jobs',
        HttpStatus.FORBIDDEN,
        { verifiedStatus: company.verifiedStatus },
      );
    }
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    this.requireManagePermission(job, company, recruiterId);
    this.requireStatus(job, JobStatus.DRAFT, 'publish');
    this.requireFutureDeadline(job.deadline);

    return this.transition(
      jobId,
      JobStatus.DRAFT,
      job.aggregateVersion,
      {
        status: JobStatus.PENDING_APPROVAL,
        publishedAt: null,
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
      JobEventAction.UPDATED,
    );
  }

  async close(
    recruiterId: string,
    authorization: string,
    jobId: string,
  ): Promise<JobDto> {
    const company = await this.companies.getRecruiterCompany(
      recruiterId,
      authorization,
    );
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    this.requireManagePermission(job, company, recruiterId);
    this.requireStatus(job, JobStatus.PUBLISHED, 'close');

    return this.transition(
      jobId,
      JobStatus.PUBLISHED,
      job.aggregateVersion,
      { status: JobStatus.CLOSED },
      JobEventAction.CLOSED,
    );
  }

  async approve(adminId: string, jobId: string): Promise<JobDto> {
    const job = await this.requireJob(jobId);
    this.requireStatus(job, JobStatus.PENDING_APPROVAL, 'approve');
    this.requireFutureDeadline(job.deadline);
    const now = new Date();

    return this.transition(
      jobId,
      JobStatus.PENDING_APPROVAL,
      job.aggregateVersion,
      {
        status: JobStatus.PUBLISHED,
        publishedAt: now,
        rejectionReason: null,
        reviewedBy: adminId,
        reviewedAt: now,
      },
      JobEventAction.UPDATED,
    );
  }

  async reject(
    adminId: string,
    jobId: string,
    reason: string,
  ): Promise<JobDto> {
    const job = await this.requireJob(jobId);
    this.requireStatus(job, JobStatus.PENDING_APPROVAL, 'reject');
    const normalizedReason = reason.normalize('NFKC').trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 1000) {
      throw new ApiException(
        'INVALID_REJECTION_REASON',
        'Rejection reason must contain 3 to 1000 non-blank characters',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.transition(
      jobId,
      JobStatus.PENDING_APPROVAL,
      job.aggregateVersion,
      {
        status: JobStatus.DRAFT,
        publishedAt: null,
        rejectionReason: normalizedReason,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
      JobEventAction.UPDATED,
    );
  }

  async expirePublishedJobs(now = new Date()): Promise<number> {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    let expired = 0;
    let cursor: string | undefined;

    while (true) {
      const candidates = await this.prisma.job.findMany({
        where: {
          status: JobStatus.PUBLISHED,
          deadline: { lt: today },
        },
        orderBy: { id: 'asc' },
        take: JOB_EXPIRY_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!candidates.length) break;
      cursor = candidates.at(-1)?.id;

      for (const candidate of candidates) {
        const change = await this.prisma.$transaction(
          async (transaction): Promise<CommittedJobChange | null> => {
            const result = await transaction.job.updateMany({
              where: {
                id: candidate.id,
                status: JobStatus.PUBLISHED,
                deadline: { lt: today },
                aggregateVersion: candidate.aggregateVersion,
              },
              data: {
                status: JobStatus.EXPIRED,
                aggregateVersion: { increment: 1 },
              },
            });
            if (result.count !== 1) return null;
            const job = await this.requireJob(
              candidate.id,
              transaction,
            );
            await this.indexing.append(transaction, job);
            const eventId = await this.events.append(
              transaction,
              job,
              JobEventAction.EXPIRED,
            );
            return { job, eventId };
          },
        );
        if (!change) continue;
        expired += 1;
        this.afterCommit([change]);
      }

      if (candidates.length < JOB_EXPIRY_BATCH_SIZE) break;
    }

    return expired;
  }

  private async requireJob(
    jobId: string,
    database: Pick<Prisma.TransactionClient, 'job'> = this.prisma,
  ): Promise<Job> {
    const job = await database.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new ApiException(
        'JOB_NOT_FOUND',
        'Job was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return job;
  }

  private requireStatus(
    job: Job,
    expected: JobStatus,
    action: string,
  ): void {
    if (job.status !== expected) {
      throw new ApiException(
        'INVALID_JOB_STATUS',
        `Job must be ${expected} to perform action: ${action}`,
        HttpStatus.CONFLICT,
        { currentStatus: job.status, expectedStatus: expected },
      );
    }
  }

  private requireFutureDeadline(deadline: Date): void {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (deadline.getTime() <= today.getTime()) {
      throw new ApiException(
        'JOB_DEADLINE_PASSED',
        'Job deadline must be later than today',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async transition(
    jobId: string,
    expectedStatus: JobStatus,
    expectedVersion: number,
    data: Prisma.JobUpdateManyMutationInput,
    eventAction: JobEventAction,
  ): Promise<JobDto> {
    const job = await this.commitChange(
      eventAction,
      async (transaction) => {
        const result = await transaction.job.updateMany({
          where: {
            id: jobId,
            status: expectedStatus,
            aggregateVersion: expectedVersion,
          },
          data: {
            ...data,
            aggregateVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          throw new ApiException(
            'JOB_STATE_CHANGED',
            'Job changed during this request; please retry',
            HttpStatus.CONFLICT,
          );
        }
        return this.requireJob(jobId, transaction);
      },
    );
    return this.toDto(job);
  }

  private async commitChange(
    action: JobEventAction,
    mutation: (transaction: Prisma.TransactionClient) => Promise<Job>,
  ): Promise<Job> {
    const change = await this.prisma.$transaction(
      async (transaction): Promise<CommittedJobChange> => {
        const job = await mutation(transaction);
        await this.indexing.append(transaction, job);
        const eventId = await this.events.append(
          transaction,
          job,
          action,
        );
        return { job, eventId };
      },
    );
    this.afterCommit([change]);
    return change.job;
  }

  private afterCommit(changes: CommittedJobChange[]): void {
    if (changes.length) {
      this.indexing.wake();
      this.events.wake();
    }
  }

  private requireManagePermission(
    job: Job | null,
    company: RecruiterCompany,
    recruiterId: string,
  ): asserts job is Job {
    if (!job || job.companyId !== company.companyId) {
      throw new ApiException(
        'JOB_NOT_FOUND',
        'Job was not found in this company',
        HttpStatus.NOT_FOUND,
      );
    }
    if (
      company.memberRole === 'MEMBER' &&
      job.createdBy !== recruiterId
    ) {
      throw new ApiException(
        'JOB_ACCESS_DENIED',
        'MEMBER can only manage jobs they created',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private validateAndMap(dto: CreateJobDto) {
    const deadline = new Date(dto.deadline + 'T00:00:00.000Z');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (
      Number.isNaN(deadline.getTime()) ||
      deadline.getTime() <= today.getTime()
    ) {
      throw new ApiException(
        'INVALID_DEADLINE',
        'deadline must be later than today',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.isNegotiable) {
      if (dto.salaryMin !== undefined || dto.salaryMax !== undefined) {
        throw new ApiException(
          'INVALID_SALARY_MODE',
          'Negotiable jobs must omit salaryMin and salaryMax',
          HttpStatus.BAD_REQUEST,
        );
      }
    } else if (
      dto.salaryMin === undefined ||
      dto.salaryMax === undefined ||
      dto.salaryMin > dto.salaryMax
    ) {
      throw new ApiException(
        'INVALID_SALARY_RANGE',
        'salaryMin and salaryMax are required and min must not exceed max',
        HttpStatus.BAD_REQUEST,
      );
    }

    const skills = [...new Set(
      dto.skills.map((skill) => skill.normalize('NFKC').trim()),
    )].filter(Boolean);
    if (!skills.length) {
      throw new ApiException(
        'SKILLS_REQUIRED',
        'At least one non-blank skill is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      title: dto.title.normalize('NFKC').trim(),
      description: dto.description.trim(),
      requirements: dto.requirements.trim(),
      benefits: dto.benefits.trim(),
      salaryMin: dto.isNegotiable ? null : dto.salaryMin,
      salaryMax: dto.isNegotiable ? null : dto.salaryMax,
      isNegotiable: dto.isNegotiable,
      currency: dto.currency.toUpperCase(),
      location: dto.location.normalize('NFKC').trim(),
      jobType: dto.jobType,
      experienceYears: dto.experienceYears,
      quantity: dto.quantity,
      skills,
      deadline,
    };
  }

  private toDto(job: Job): JobDto {
    return {
      id: job.id,
      companyId: job.companyId,
      createdBy: job.createdBy,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      benefits: job.benefits,
      salaryMin: job.salaryMin?.toString() ?? null,
      salaryMax: job.salaryMax?.toString() ?? null,
      isNegotiable: job.isNegotiable,
      currency: job.currency,
      location: job.location,
      jobType: job.jobType,
      experienceYears: job.experienceYears,
      quantity: job.quantity,
      skills: job.skills,
      deadline: job.deadline.toISOString().slice(0, 10),
      status: job.status,
      publishedAt: job.publishedAt?.toISOString() ?? null,
      rejectionReason: job.rejectionReason,
      reviewedBy: job.reviewedBy,
      reviewedAt: job.reviewedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private toJobDetail(job: Job, now: Date): JobDetailDto {
    const availabilityReason = this.availabilityReason(job, now);
    return {
      id: job.id,
      companyId: job.companyId,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      benefits: job.benefits,
      salaryMin: job.salaryMin?.toString() ?? null,
      salaryMax: job.salaryMax?.toString() ?? null,
      isNegotiable: job.isNegotiable,
      currency: job.currency,
      location: job.location,
      jobType: job.jobType,
      experienceYears: job.experienceYears,
      quantity: job.quantity,
      skills: job.skills,
      deadline: job.deadline.toISOString().slice(0, 10),
      status: job.status,
      publishedAt: job.publishedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      acceptingApplications: availabilityReason === null,
      availabilityReason,
    };
  }

  private availabilityReason(
    job: Pick<Job, 'status' | 'deadline'>,
    now: Date,
  ): JobAvailabilityReason | null {
    if (job.status !== JobStatus.PUBLISHED) {
      return JobAvailabilityReason.NOT_PUBLISHED;
    }
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    return job.deadline.getTime() < today.getTime()
      ? JobAvailabilityReason.DEADLINE_PASSED
      : null;
  }

  private candidateRecommendationContextStale(): ApiException {
    return new ApiException(
      'JOB_RECOMMENDATION_CONTEXT_STALE',
      'Recruiter authorization or Job changed while recommendations were resolved',
      HttpStatus.CONFLICT,
    );
  }
}
