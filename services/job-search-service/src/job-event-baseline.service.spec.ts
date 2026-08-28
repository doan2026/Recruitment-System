import {
  Job,
  JobEventAction,
  JobStatus,
  JobType,
  Prisma,
} from '@prisma/client';
import {
  baselineAction,
  JobEventBaselineService,
} from './job-event-baseline.service';
import { JobEventPublisherService } from './job-event-publisher.service';
import { PrismaService } from './prisma.service';

const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function job(status: JobStatus, sequence = 1): Job {
  return {
    id: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    companyId: COMPANY_ID,
    createdBy: '33333333-3333-4333-8333-333333333333',
    title: 'Backend Engineer',
    description: 'Build recruitment services',
    requirements: 'NestJS and Kafka',
    benefits: 'Remote work',
    salaryMin: new Prisma.Decimal('20000000.00'),
    salaryMax: new Prisma.Decimal('30000000.00'),
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 2,
    quantity: 2,
    skills: ['NestJS', 'Kafka'],
    deadline: new Date('2099-12-31T00:00:00.000Z'),
    status,
    aggregateVersion: sequence,
    publishedAt: status === JobStatus.PUBLISHED
      ? new Date('2026-08-27T00:00:00.000Z')
      : null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
  };
}

describe('JobEventBaselineService', () => {
  it.each([
    [JobStatus.DRAFT, JobEventAction.UPDATED],
    [JobStatus.PENDING_APPROVAL, JobEventAction.UPDATED],
    [JobStatus.PUBLISHED, JobEventAction.UPDATED],
    [JobStatus.CLOSED, JobEventAction.CLOSED],
    [JobStatus.EXPIRED, JobEventAction.EXPIRED],
  ])('maps %s to the safe snapshot action %s', (status, action) => {
    expect(baselineAction({ status })).toBe(action);
  });

  it('is dry-run by option and never starts a write transaction', async () => {
    const transaction = jest.fn();
    const queryRaw = jest.fn().mockResolvedValue([inspection({
      totalJobs: 7,
      missingCurrentEvents: 5,
      pendingOutboxEvents: 2,
    })]);
    const service = new JobEventBaselineService(
      {
        $queryRaw: queryRaw,
        $transaction: transaction,
      } as unknown as PrismaService,
      {} as JobEventPublisherService,
    );

    const result = await service.run({
      execute: false,
      batchSize: 100,
      maxBatches: 1,
      now: new Date('2026-08-28T23:59:59.999Z'),
    });

    expect(result).toEqual({
      totalJobs: 7,
      stalePublishedJobs: 0,
      missingCurrentEventsBefore: 5,
      selectedJobs: 0,
      insertedEvents: 0,
      processedBatches: 0,
      remainingCurrentEvents: 5,
      pendingOutboxEvents: 2,
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(queryRaw.mock.calls[0][1]).toBe('2026-08-28');
  });

  it('fails execute preflight when a published deadline is already stale',
  async () => {
    const transaction = jest.fn();
    const service = new JobEventBaselineService(
      {
        $queryRaw: jest.fn().mockResolvedValue([inspection({
          totalJobs: 1,
          stalePublishedJobs: 1,
          missingCurrentEvents: 1,
        })]),
        $transaction: transaction,
      } as unknown as PrismaService,
      {} as JobEventPublisherService,
    );

    const result = await service.run({
      execute: true,
      batchSize: 100,
      maxBatches: 1,
      now: new Date('2026-08-28T00:00:00.000Z'),
    });

    expect(result.stalePublishedJobs).toBe(1);
    expect(result.insertedEvents).toBe(0);
    expect(result.remainingCurrentEvents).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('locks one missing batch and appends the exact status mapping',
  async () => {
    const jobs = [
      job(JobStatus.DRAFT, 1),
      job(JobStatus.PENDING_APPROVAL, 2),
      job(JobStatus.PUBLISHED, 3),
      job(JobStatus.CLOSED, 4),
      job(JobStatus.EXPIRED, 5),
    ];
    const transactionQuery = jest.fn().mockResolvedValue(
      jobs.map(({ id }) => ({ id })),
    );
    const transaction = {
      $queryRaw: transactionQuery,
      job: { findMany: jest.fn().mockResolvedValue([...jobs].reverse()) },
    } as unknown as Prisma.TransactionClient;
    const rootTransaction = jest.fn(
      async (operation: (value: Prisma.TransactionClient) => unknown) =>
        operation(transaction),
    );
    const rootQuery = jest.fn()
      .mockResolvedValueOnce([inspection({
        totalJobs: 5,
        missingCurrentEvents: 5,
      })])
      .mockResolvedValueOnce([inspection({
        totalJobs: 5,
        missingCurrentEvents: 0,
        pendingOutboxEvents: 5,
      })]);
    const appendBaselineSnapshot = jest.fn()
      .mockImplementation(async (_transaction, source: Job) => source.id);
    const service = new JobEventBaselineService(
      {
        $queryRaw: rootQuery,
        $transaction: rootTransaction,
      } as unknown as PrismaService,
      { appendBaselineSnapshot } as unknown as JobEventPublisherService,
    );

    const result = await service.run({
      execute: true,
      batchSize: 5,
      maxBatches: 1,
      now: new Date('2026-08-28T00:00:00.000Z'),
    });

    expect(result).toEqual({
      totalJobs: 5,
      stalePublishedJobs: 0,
      missingCurrentEventsBefore: 5,
      selectedJobs: 5,
      insertedEvents: 5,
      processedBatches: 1,
      remainingCurrentEvents: 0,
      pendingOutboxEvents: 5,
    });
    expect(appendBaselineSnapshot.mock.calls.map((call) => [
      (call[1] as Job).status,
      call[2],
    ])).toEqual([
      [JobStatus.DRAFT, JobEventAction.UPDATED],
      [JobStatus.PENDING_APPROVAL, JobEventAction.UPDATED],
      [JobStatus.PUBLISHED, JobEventAction.UPDATED],
      [JobStatus.CLOSED, JobEventAction.CLOSED],
      [JobStatus.EXPIRED, JobEventAction.EXPIRED],
    ]);
    const sql = (
      transactionQuery.mock.calls[0][0] as TemplateStringsArray
    ).join('?');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('source."aggregate_version"');
    expect(sql).toContain('FOR UPDATE OF source SKIP LOCKED');
    expect(transactionQuery.mock.calls[0][1]).toBe(5);
  });

  it.each([
    { execute: true, batchSize: 0, maxBatches: 1 },
    { execute: true, batchSize: 501, maxBatches: 1 },
    { execute: true, batchSize: 1, maxBatches: 0 },
    { execute: true, batchSize: 1, maxBatches: 10_001 },
  ])('rejects unsafe service options before querying: %j', async (options) => {
    const queryRaw = jest.fn();
    const service = new JobEventBaselineService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      {} as JobEventPublisherService,
    );

    await expect(service.run(options)).rejects.toThrow('must be an integer');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

function inspection(
  overrides: Partial<Record<
    | 'totalJobs'
    | 'stalePublishedJobs'
    | 'missingCurrentEvents'
    | 'pendingOutboxEvents',
    number
  >> = {},
) {
  return {
    totalJobs: 0,
    stalePublishedJobs: 0,
    missingCurrentEvents: 0,
    pendingOutboxEvents: 0,
    ...overrides,
  };
}
