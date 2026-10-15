import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { CompanyClientService } from './company-client.service';
import { JobAvailabilityReason } from './job-availability.dto';
import {
  BulkJobDetailRequestDto,
  MAX_BULK_JOB_DETAIL_IDS,
} from './job-detail.dto';
import { JobEventPublisherService } from './job-event-publisher.service';
import { JobIndexingService } from './job-indexing.service';
import { JobService } from './job.service';
import { PrismaService } from './prisma.service';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const RECRUITER_ID = '22222222-2222-4222-8222-222222222222';
const PUBLISHED_ID = '33333333-3333-4333-8333-333333333333';
const HIDDEN_ID = '44444444-4444-4444-8444-444444444444';
const CLOSED_ID = '55555555-5555-4555-8555-555555555555';
const MISSING_ID = '66666666-6666-4666-8666-666666666666';

function job(
  id: string,
  status: JobStatus,
  overrides: Partial<Job> = {},
): Job {
  return {
    id,
    companyId: COMPANY_ID,
    createdBy: RECRUITER_ID,
    title: `Job ${id.slice(0, 4)}`,
    description: 'Public description',
    requirements: 'NestJS',
    benefits: 'Remote',
    salaryMin: new Prisma.Decimal(20_000_000),
    salaryMax: new Prisma.Decimal(30_000_000),
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 2,
    quantity: 1,
    skills: ['NestJS'],
    deadline: new Date('2099-12-31T00:00:00.000Z'),
    status,
    aggregateVersion: 1,
    publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    rejectionReason: 'must never be exposed',
    reviewedBy: RECRUITER_ID,
    reviewedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('BulkJobDetailRequestDto', () => {
  it('accepts one to 100 unique UUID v4 values', async () => {
    const dto = plainToInstance(BulkJobDetailRequestDto, {
      jobIds: Array.from(
        { length: MAX_BULK_JOB_DETAIL_IDS },
        () => randomUUID(),
      ),
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    { jobIds: [], label: 'empty arrays' },
    { jobIds: [PUBLISHED_ID, PUBLISHED_ID], label: 'duplicates' },
    {
      jobIds: Array.from(
        { length: MAX_BULK_JOB_DETAIL_IDS + 1 },
        () => randomUUID(),
      ),
      label: 'more than 100 ids',
    },
    { jobIds: ['not-a-uuid'], label: 'invalid ids' },
    {
      jobIds: [PUBLISHED_ID, PUBLISHED_ID.toUpperCase()],
      label: 'duplicates that differ only in case',
    },
  ])('rejects $label', async ({ jobIds }) => {
    const dto = plainToInstance(BulkJobDetailRequestDto, { jobIds });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('lowercases ids so an uppercase UUID still resolves to its job', async () => {
    const dto = plainToInstance(BulkJobDetailRequestDto, {
      jobIds: [PUBLISHED_ID.toUpperCase()],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.jobIds).toEqual([PUBLISHED_ID.toLowerCase()]);
  });
});

describe('JobService.getBulkDetails', () => {
  let findMany: jest.Mock;
  let service: JobService;

  beforeEach(() => {
    findMany = jest.fn();
    const prisma = { job: { findMany } } as unknown as PrismaService;
    service = new JobService(
      prisma,
      {} as CompanyClientService,
      {} as JobIndexingService,
      {} as JobEventPublisherService,
    );
  });

  it('uses one query, preserves input order and hides moderation metadata', async () => {
    findMany.mockResolvedValue([
      job(CLOSED_ID, JobStatus.CLOSED),
      job(PUBLISHED_ID, JobStatus.PUBLISHED),
    ]);

    const result = await service.getBulkDetails(
      [PUBLISHED_ID, HIDDEN_ID, CLOSED_ID, MISSING_ID],
      new Date('2026-08-26T12:00:00.000Z'),
    );

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [PUBLISHED_ID, HIDDEN_ID, CLOSED_ID, MISSING_ID],
        },
        status: {
          in: [
            JobStatus.PUBLISHED,
            JobStatus.CLOSED,
            JobStatus.EXPIRED,
          ],
        },
      },
    });
    expect(result.items.map(({ id }) => id)).toEqual([
      PUBLISHED_ID,
      CLOSED_ID,
    ]);
    expect(result.unavailableJobIds).toEqual([HIDDEN_ID, MISSING_ID]);
    expect(result.items[0]).toMatchObject({
      acceptingApplications: true,
      availabilityReason: null,
    });
    expect(result.items[1]).toMatchObject({
      acceptingApplications: false,
      availabilityReason: JobAvailabilityReason.NOT_PUBLISHED,
    });
    expect(result.items[0]).not.toHaveProperty('createdBy');
    expect(result.items[0]).not.toHaveProperty('rejectionReason');
    expect(result.items[0]).not.toHaveProperty('reviewedBy');
  });

  it('keeps an expired-deadline published job visible but unavailable', async () => {
    findMany.mockResolvedValue([
      job(PUBLISHED_ID, JobStatus.PUBLISHED, {
        deadline: new Date('2026-08-25T00:00:00.000Z'),
      }),
    ]);

    const result = await service.getBulkDetails(
      [PUBLISHED_ID],
      new Date('2026-08-26T12:00:00.000Z'),
    );

    expect(result.items[0]).toMatchObject({
      acceptingApplications: false,
      availabilityReason: JobAvailabilityReason.DEADLINE_PASSED,
    });
  });

  it('does not query PostgreSQL for an empty internal call', async () => {
    await expect(service.getBulkDetails([])).resolves.toEqual({
      items: [],
      unavailableJobIds: [],
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
