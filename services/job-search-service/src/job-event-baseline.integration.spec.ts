import { ConfigService } from '@nestjs/config';
import {
  Job,
  JobEventAction,
  JobStatus,
  JobType,
} from '@prisma/client';
import { JOB_EVENT_PAYLOAD_FIELDS } from './job-event';
import { JobEventBaselineService } from './job-event-baseline.service';
import { JobEventPublisherService } from './job-event-publisher.service';
import { PrismaService } from './prisma.service';

const integrationDescribe =
  process.env.JOB_INTEGRATION_TEST === '1' ? describe : describe.skip;
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const RECRUITER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-28T12:00:00.000Z');

integrationDescribe('Job historical event baseline', () => {
  jest.setTimeout(30_000);

  let prisma: PrismaService;
  let publisher: JobEventPublisherService;
  let baseline: JobEventBaselineService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    publisher = new JobEventPublisherService(prisma, config());
    baseline = new JobEventBaselineService(prisma, publisher);
  });

  beforeEach(async () => {
    await prisma.jobIndexSync.deleteMany();
    await prisma.jobEventOutbox.deleteMany();
    await prisma.job.deleteMany();
  });

  afterAll(async () => {
    if (publisher) await publisher.onModuleDestroy();
    if (prisma) await prisma.onModuleDestroy();
  });

  it('resumes bounded batches and preserves every Job aggregate field',
  async () => {
    const statuses = [
      JobStatus.DRAFT,
      JobStatus.PENDING_APPROVAL,
      JobStatus.PUBLISHED,
      JobStatus.CLOSED,
      JobStatus.EXPIRED,
    ];
    const historical = await Promise.all(statuses.map((status, index) =>
      createJob(index + 1, status, index + 1),
    ));
    const covered = await createJob(6, JobStatus.DRAFT, 6);
    const legacy = await createJob(7, JobStatus.PUBLISHED, 7);
    const coveredEventId = await prisma.$transaction((transaction) =>
      publisher.append(transaction, covered, JobEventAction.UPDATED),
    );
    await prisma.$transaction((transaction) =>
      publisher.append(
        transaction,
        { ...legacy, aggregateVersion: 6 },
        JobEventAction.UPDATED,
      ),
    );
    const sourceBefore = await sourceVersions();

    const dryRun = await baseline.run({
      execute: false,
      batchSize: 2,
      maxBatches: 1,
      now: NOW,
    });
    expect(dryRun.missingCurrentEventsBefore).toBe(6);
    expect(dryRun.insertedEvents).toBe(0);
    expect(await prisma.jobEventOutbox.count()).toBe(2);

    const first = await baseline.run({
      execute: true,
      batchSize: 2,
      maxBatches: 1,
      now: NOW,
    });
    expect(first.insertedEvents).toBe(2);
    expect(first.processedBatches).toBe(1);
    expect(first.remainingCurrentEvents).toBe(4);

    const resumed = await baseline.run({
      execute: true,
      batchSize: 2,
      maxBatches: 10,
      now: NOW,
    });
    expect(resumed.insertedEvents).toBe(4);
    expect(resumed.remainingCurrentEvents).toBe(0);

    const currentEvents = await prisma.jobEventOutbox.findMany({
      where: {
        OR: [
          ...historical.map((job) => ({
            jobId: job.id,
            aggregateVersion: job.aggregateVersion,
          })),
          { jobId: covered.id, aggregateVersion: covered.aggregateVersion },
          { jobId: legacy.id, aggregateVersion: legacy.aggregateVersion },
        ],
      },
      orderBy: { jobId: 'asc' },
    });
    expect(currentEvents).toHaveLength(7);
    expect(currentEvents.find(({ jobId }) => jobId === covered.id)?.id)
      .toBe(coveredEventId);
    expect(currentEvents.map(({ jobId, aggregateVersion, action, payload }) => ({
      jobId,
      aggregateVersion,
      action,
      payloadAction: (payload as Record<string, unknown>).action,
      payloadVersion: (payload as Record<string, unknown>).aggregate_version,
      payloadFields: Object.keys(payload as Record<string, unknown>).sort(),
    }))).toEqual([
      ...historical,
      covered,
      legacy,
    ].sort((left, right) => left.id.localeCompare(right.id)).map((job) => {
      const action = expectedAction(job.status);
      return {
        jobId: job.id,
        aggregateVersion: job.aggregateVersion,
        action,
        payloadAction: action,
        payloadVersion: job.aggregateVersion,
        payloadFields: [...JOB_EVENT_PAYLOAD_FIELDS].sort(),
      };
    }));
    expect(await prisma.jobEventOutbox.findMany({
      where: { jobId: legacy.id },
      orderBy: { aggregateVersion: 'asc' },
      select: { aggregateVersion: true },
    })).toEqual([{ aggregateVersion: 6 }, { aggregateVersion: 7 }]);
    expect(await sourceVersions()).toEqual(sourceBefore);

    const repeated = await baseline.run({
      execute: true,
      batchSize: 500,
      maxBatches: 2,
      now: NOW,
    });
    expect(repeated.insertedEvents).toBe(0);
    expect(repeated.remainingCurrentEvents).toBe(0);
    expect(await prisma.jobEventOutbox.count()).toBe(8);
  });

  it('fails stale-published preflight without writing a partial baseline',
  async () => {
    await Promise.all([
      createJob(
        20,
        JobStatus.PUBLISHED,
        3,
        new Date('2026-08-27T00:00:00.000Z'),
      ),
      createJob(21, JobStatus.DRAFT, 1),
    ]);

    const result = await baseline.run({
      execute: true,
      batchSize: 100,
      maxBatches: 10,
      now: NOW,
    });

    expect(result.stalePublishedJobs).toBe(1);
    expect(result.insertedEvents).toBe(0);
    expect(result.remainingCurrentEvents).toBe(2);
    expect(await prisma.jobEventOutbox.count()).toBe(0);
  });

  it('serializes concurrent one-shot runs without duplicate snapshots',
  async () => {
    const jobs = await Promise.all(Array.from(
      { length: 20 },
      (_, index) => createJob(100 + index, JobStatus.DRAFT, 1),
    ));
    const competing = new JobEventBaselineService(prisma, publisher);

    const results = await Promise.all([
      baseline.run({
        execute: true,
        batchSize: 500,
        maxBatches: 1,
        now: NOW,
      }),
      competing.run({
        execute: true,
        batchSize: 500,
        maxBatches: 1,
        now: NOW,
      }),
    ]);

    expect(results.reduce((sum, result) => sum + result.insertedEvents, 0))
      .toBe(20);
    const rows = await prisma.jobEventOutbox.findMany({
      select: {
        jobId: true,
        aggregateVersion: true,
      },
    });
    expect(rows).toHaveLength(jobs.length);
    expect(new Set(rows.map(({ jobId, aggregateVersion }) =>
      `${jobId}:${aggregateVersion}`,
    )).size).toBe(jobs.length);
    expect((await baseline.run({
      execute: false,
      batchSize: 100,
      maxBatches: 1,
      now: NOW,
    })).remainingCurrentEvents).toBe(0);
  });

  async function createJob(
    sequence: number,
    status: JobStatus,
    aggregateVersion: number,
    deadline = new Date('2099-12-31T00:00:00.000Z'),
  ): Promise<Job> {
    return prisma.job.create({
      data: {
        id: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        companyId: COMPANY_ID,
        createdBy: RECRUITER_ID,
        title: `Backend Engineer ${sequence}`,
        description: 'Build recruitment services',
        requirements: 'NestJS, PostgreSQL and Kafka',
        benefits: 'Remote work',
        salaryMin: '20000000.00',
        salaryMax: '30000000.00',
        isNegotiable: false,
        currency: 'VND',
        location: 'Ha Noi',
        jobType: JobType.FULL_TIME,
        experienceYears: 2,
        quantity: 2,
        skills: ['NestJS', 'Kafka'],
        deadline,
        status,
        aggregateVersion,
        publishedAt: status === JobStatus.PUBLISHED ? NOW : null,
        updatedAt: new Date(`2026-08-${String(1 + sequence % 20).padStart(2, '0')}T00:00:00.000Z`),
      },
    });
  }

  function sourceVersions() {
    return prisma.job.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        aggregateVersion: true,
        updatedAt: true,
      },
    });
  }
});

function config(): ConfigService {
  const values: Record<string, string> = {
    JOB_EVENT_PUBLISHER_ENABLED: 'false',
    KAFKA_BROKERS: 'kafka-test:9092',
    KAFKA_JOB_TOPIC: 'job-events',
    JOB_EVENT_OUTBOX_LEASE_MS: '30000',
  };
  return { get: (key: string) => values[key] } as ConfigService;
}

function expectedAction(status: JobStatus): JobEventAction {
  if (status === JobStatus.CLOSED) return JobEventAction.CLOSED;
  if (status === JobStatus.EXPIRED) return JobEventAction.EXPIRED;
  return JobEventAction.UPDATED;
}
