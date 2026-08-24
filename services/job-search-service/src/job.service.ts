import { HttpStatus, Injectable } from '@nestjs/common';
import { Job, JobStatus, Prisma } from '@prisma/client';
import { ApiException } from './common';
import {
  CompanyClientService,
  RecruiterCompany,
} from './company-client.service';
import { CreateJobDto, JobDto, UpdateJobDto } from './job.dto';
import { PrismaService } from './prisma.service';

@Injectable()
export class JobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyClientService,
  ) {}

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
    const job = await this.prisma.job.create({
      data: {
        ...data,
        companyId: company.companyId,
        createdBy: recruiterId,
        status: JobStatus.DRAFT,
      },
    });
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
    return this.toDto(job);
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
    const data: Prisma.JobUpdateInput = this.validateAndMap(merged);
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
    }

    return this.toDto(
      await this.prisma.job.update({
        where: { id: jobId },
        data,
      }),
    );
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
      ...job,
      salaryMin: job.salaryMin?.toString() ?? null,
      salaryMax: job.salaryMax?.toString() ?? null,
      deadline: job.deadline.toISOString().slice(0, 10),
      publishedAt: job.publishedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
