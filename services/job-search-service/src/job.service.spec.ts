import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import { CompanyClientService } from './company-client.service';
import { JobAvailabilityReason } from './job-availability.dto';
import { JobIndexingService } from './job-indexing.service';
import { JobService } from './job.service';
import { PrismaService } from './prisma.service';

const RECRUITER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

function job(status: JobStatus, overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    companyId: COMPANY_ID,
    createdBy: RECRUITER_ID,
    title: 'Backend Engineer',
    description: 'Build recruitment services',
    requirements: 'NestJS',
    benefits: 'Remote work',
    salaryMin: new Prisma.Decimal(20_000_000),
    salaryMax: new Prisma.Decimal(30_000_000),
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 2,
    quantity: 2,
    skills: ['NestJS'],
    deadline: new Date('2099-12-31T00:00:00.000Z'),
    status,
    publishedAt: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

describe('JobService publishing lifecycle', () => {
  let service: JobService;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let updateMany: jest.Mock;
  let getRecruiterCompany: jest.Mock;
  let schedule: jest.Mock;

  beforeEach(() => {
    findUnique = jest.fn();
    findMany = jest.fn();
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    schedule = jest.fn().mockResolvedValue(undefined);
    getRecruiterCompany = jest.fn().mockResolvedValue({
      companyId: COMPANY_ID,
      memberRole: 'OWNER',
      verifiedStatus: 'VERIFIED',
    });
    const prisma = {
      job: { findUnique, findMany, updateMany },
    } as unknown as PrismaService;
    const companies = {
      getRecruiterCompany,
    } as unknown as CompanyClientService;
    const indexing = { schedule } as unknown as JobIndexingService;
    service = new JobService(prisma, companies, indexing);
  });

  it('submits an owned DRAFT job for approval', async () => {
    findUnique
      .mockResolvedValueOnce(job(JobStatus.DRAFT))
      .mockResolvedValueOnce(job(JobStatus.PENDING_APPROVAL));

    const result = await service.publish(RECRUITER_ID, 'Bearer token', JOB_ID);

    expect(result.status).toBe(JobStatus.PENDING_APPROVAL);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, status: JobStatus.DRAFT },
      data: {
        status: JobStatus.PENDING_APPROVAL,
        publishedAt: null,
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: JOB_ID,
        status: JobStatus.PENDING_APPROVAL,
      }),
      'UPDATED',
    );
  });

  it('prevents a MEMBER from publishing another recruiter job', async () => {
    getRecruiterCompany.mockResolvedValue({
      companyId: COMPANY_ID,
      memberRole: 'MEMBER',
      verifiedStatus: 'VERIFIED',
    });
    findUnique.mockResolvedValue(
      job(JobStatus.DRAFT, {
        createdBy: '55555555-5555-4555-8555-555555555555',
      }),
    );

    await expect(
      service.publish(RECRUITER_ID, 'Bearer token', JOB_ID),
    ).rejects.toMatchObject({ code: 'JOB_ACCESS_DENIED' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('reports a current PUBLISHED job as accepting applications', async () => {
    findUnique.mockResolvedValue(job(JobStatus.PUBLISHED));

    await expect(service.getAvailability(JOB_ID)).resolves.toMatchObject({
      jobId: JOB_ID,
      exists: true,
      acceptingApplications: true,
      reason: null,
      companyId: COMPANY_ID,
      recruiterId: RECRUITER_ID,
    });
  });

  it('reports a missing job without leaking metadata', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.getAvailability(JOB_ID)).resolves.toEqual({
      jobId: JOB_ID,
      exists: false,
      acceptingApplications: false,
      reason: JobAvailabilityReason.NOT_FOUND,
      companyId: null,
      recruiterId: null,
      jobTitle: null,
      status: null,
      deadline: null,
    });
  });

  it('does not accept applications for a non-published job', async () => {
    findUnique.mockResolvedValue(job(JobStatus.CLOSED));

    await expect(service.getAvailability(JOB_ID)).resolves.toMatchObject({
      exists: true,
      acceptingApplications: false,
      reason: JobAvailabilityReason.NOT_PUBLISHED,
      status: JobStatus.CLOSED,
    });
  });

  it('does not accept applications after the UTC deadline', async () => {
    findUnique.mockResolvedValue(
      job(JobStatus.PUBLISHED, {
        deadline: new Date('2020-01-01T00:00:00.000Z'),
      }),
    );

    await expect(service.getAvailability(JOB_ID)).resolves.toMatchObject({
      exists: true,
      acceptingApplications: false,
      reason: JobAvailabilityReason.DEADLINE_PASSED,
    });
  });

  it('approves only a pending job and records the admin review', async () => {
    findUnique
      .mockResolvedValueOnce(job(JobStatus.PENDING_APPROVAL))
      .mockResolvedValueOnce(
        job(JobStatus.PUBLISHED, {
          publishedAt: new Date(),
          reviewedBy: ADMIN_ID,
          reviewedAt: new Date(),
        }),
      );

    const result = await service.approve(ADMIN_ID, JOB_ID);

    expect(result.status).toBe(JobStatus.PUBLISHED);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, status: JobStatus.PENDING_APPROVAL },
      data: expect.objectContaining({
        status: JobStatus.PUBLISHED,
        reviewedBy: ADMIN_ID,
        rejectionReason: null,
      }),
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: JOB_ID,
        status: JobStatus.PUBLISHED,
      }),
      'UPDATED',
    );
  });

  it('returns a rejected job to DRAFT with a normalized reason', async () => {
    findUnique
      .mockResolvedValueOnce(job(JobStatus.PENDING_APPROVAL))
      .mockResolvedValueOnce(
        job(JobStatus.DRAFT, { rejectionReason: 'Content is incomplete' }),
      );

    const result = await service.reject(
      ADMIN_ID,
      JOB_ID,
      '  Content is incomplete  ',
    );

    expect(result.status).toBe(JobStatus.DRAFT);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, status: JobStatus.PENDING_APPROVAL },
      data: expect.objectContaining({
        status: JobStatus.DRAFT,
        rejectionReason: 'Content is incomplete',
        reviewedBy: ADMIN_ID,
      }),
    });
  });

  it('rejects a blank moderation reason', async () => {
    findUnique.mockResolvedValue(job(JobStatus.PENDING_APPROVAL));

    await expect(
      service.reject(ADMIN_ID, JOB_ID, '   '),
    ).rejects.toMatchObject({ code: 'INVALID_REJECTION_REASON' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('expires only published jobs before the current UTC date', async () => {
    findMany.mockResolvedValue([
      job(JobStatus.PUBLISHED),
      job(JobStatus.PUBLISHED, {
        id: '55555555-5555-4555-8555-555555555555',
      }),
      job(JobStatus.PUBLISHED, {
        id: '66666666-6666-4666-8666-666666666666',
      }),
    ]);
    updateMany.mockResolvedValue({ count: 3 });
    const now = new Date('2026-08-24T15:30:00.000Z');

    await expect(service.expirePublishedJobs(now)).resolves.toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [
            JOB_ID,
            '55555555-5555-4555-8555-555555555555',
            '66666666-6666-4666-8666-666666666666',
          ],
        },
        status: JobStatus.PUBLISHED,
        deadline: { lt: new Date('2026-08-24T00:00:00.000Z') },
      },
      data: { status: JobStatus.EXPIRED },
    });
    expect(schedule).toHaveBeenCalledTimes(3);
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: JOB_ID,
        status: JobStatus.EXPIRED,
      }),
      'EXPIRED',
    );
  });
});
