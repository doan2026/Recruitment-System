import { ConfigService } from '@nestjs/config';
import {
  Job,
  JobEventAction,
  JobEventOutbox,
  JobStatus,
  JobType,
  Prisma,
} from '@prisma/client';
import { JOB_EVENT_PAYLOAD_FIELDS } from './job-event';
import { Kafka } from 'kafkajs';
import { JobEventPublisherService } from './job-event-publisher.service';
import { PrismaService } from './prisma.service';

jest.mock('kafkajs', () => ({
  Kafka: jest.fn(),
  Partitioners: { DefaultPartitioner: jest.fn() },
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';

function persistedJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    companyId: COMPANY_ID,
    createdBy: '44444444-4444-4444-8444-444444444444',
    title: 'Backend Engineer',
    description: 'Build recruitment services',
    requirements: 'NestJS and Kafka',
    benefits: 'Remote work',
    salaryMin: new Prisma.Decimal('20000000'),
    salaryMax: new Prisma.Decimal('30000000'),
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 2,
    quantity: 2,
    skills: ['NestJS', 'Kafka'],
    deadline: new Date('2099-12-31T00:00:00.000Z'),
    status: JobStatus.PUBLISHED,
    aggregateVersion: 2,
    publishedAt: new Date('2026-08-26T00:00:00.000Z'),
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
    ...overrides,
  };
}

function persistedEvent(
  overrides: Partial<JobEventOutbox> = {},
): JobEventOutbox {
  return {
    id: EVENT_ID,
    jobId: JOB_ID,
    aggregateVersion: 2,
    action: JobEventAction.UPDATED,
    topic: 'job-events-test',
    eventKey: JOB_ID,
    payload: {
      event_id: EVENT_ID,
      action: 'UPDATED',
      job_id: JOB_ID,
      company_id: COMPANY_ID,
      title: 'Backend Engineer',
      description: 'Build recruitment services',
      skills: ['NestJS', 'Kafka'],
      location: 'Ha Noi',
      status: 'PUBLISHED',
      occurred_at: '2026-08-26T00:00:00.000Z',
      schema_version: 1,
      aggregate_version: 2,
      requirements: 'NestJS and Kafka',
      salary_min: '20000000.00',
      salary_max: '30000000.00',
      job_type: 'FULL_TIME',
    },
    attempts: 1,
    nextAttemptAt: new Date('2026-08-26T00:00:00.000Z'),
    leaseOwner: 'worker',
    leaseExpiresAt: new Date('2026-08-26T00:01:00.000Z'),
    publishedAt: null,
    lastError: null,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
    ...overrides,
  };
}

describe('JobEventPublisherService', () => {
  let connect: jest.Mock;
  let send: jest.Mock;
  let disconnect: jest.Mock;
  let queryRaw: jest.Mock;
  let findUnique: jest.Mock;
  let updateMany: jest.Mock;
  let service: JobEventPublisherService;

  beforeEach(() => {
    connect = jest.fn().mockResolvedValue(undefined);
    send = jest.fn().mockResolvedValue(undefined);
    disconnect = jest.fn().mockResolvedValue(undefined);
    (Kafka as unknown as jest.Mock).mockImplementation(() => ({
      producer: () => ({ connect, send, disconnect }),
    }));

    queryRaw = jest.fn();
    findUnique = jest.fn();
    updateMany = jest.fn();
    const prisma = {
      $queryRaw: queryRaw,
      jobEventOutbox: { findUnique, updateMany },
    } as unknown as PrismaService;
    const values: Record<string, string> = {
      KAFKA_BROKERS: 'kafka:9092',
      KAFKA_JOB_TOPIC: 'job-events-test',
      JOB_EVENT_OUTBOX_BATCH_SIZE: '10',
      JOB_EVENT_OUTBOX_RETRY_BASE_MS: '100',
      JOB_EVENT_OUTBOX_RETRY_MAX_MS: '1000',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    service = new JobEventPublisherService(prisma, config);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  it('appends the immutable enriched payload through the caller transaction',
  async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const transaction = {
      jobEventOutbox: { create },
    } as unknown as Prisma.TransactionClient;
    const job = persistedJob();

    const eventId = await service.append(
      transaction,
      job,
      JobEventAction.UPDATED,
    );

    expect(eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: eventId,
        jobId: JOB_ID,
        aggregateVersion: 2,
        action: JobEventAction.UPDATED,
        topic: 'job-events-test',
        eventKey: JOB_ID,
        payload: expect.objectContaining({
          event_id: eventId,
          schema_version: 1,
          aggregate_version: 2,
          requirements: 'NestJS and Kafka',
          salary_min: '20000000.00',
          salary_max: '30000000.00',
          job_type: 'FULL_TIME',
        }),
      }),
    });
  });

  it('appends an exact idempotent snapshot for the historical baseline',
  async () => {
    const createMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const transaction = {
      jobEventOutbox: { createMany },
    } as unknown as Prisma.TransactionClient;

    const inserted = await service.appendBaselineSnapshot(
      transaction,
      persistedJob(),
      JobEventAction.UPDATED,
    );
    const duplicate = await service.appendBaselineSnapshot(
      transaction,
      persistedJob(),
      JobEventAction.UPDATED,
    );

    expect(inserted).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(duplicate).toBeNull();
    const request = createMany.mock.calls[0][0];
    expect(request.skipDuplicates).toBe(true);
    expect(request.data).toHaveLength(1);
    expect(request.data[0]).toEqual(expect.objectContaining({
      id: inserted,
      jobId: JOB_ID,
      aggregateVersion: 2,
      action: JobEventAction.UPDATED,
      topic: 'job-events-test',
      eventKey: JOB_ID,
    }));
    expect(Object.keys(request.data[0].payload).sort()).toEqual(
      [...JOB_EVENT_PAYLOAD_FIELDS].sort(),
    );
    expect(request.data[0].payload).toEqual(expect.objectContaining({
      event_id: inserted,
      action: 'UPDATED',
      job_id: JOB_ID,
      status: 'PUBLISHED',
      aggregate_version: 2,
      schema_version: 1,
    }));
    expect(request.data[0].payload).not.toHaveProperty('benefits');
  });

  it('claims in aggregate order, publishes exact bytes and marks success',
  async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: EVENT_ID }])
      .mockResolvedValueOnce([]);
    findUnique.mockResolvedValue(persistedEvent());
    updateMany.mockResolvedValue({ count: 1 });

    await expect(service.flushPending()).resolves.toBe(1);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      topic: 'job-events-test',
      timeout: 3000,
      messages: [{
        key: JOB_ID,
        value: JSON.stringify(persistedEvent().payload),
      }],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: EVENT_ID,
        publishedAt: null,
      }),
      data: expect.objectContaining({
        publishedAt: expect.any(Date),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      }),
    });

    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('earlier."aggregate_version"');
    expect(sql).toContain('earlier."published_at" IS NULL');
  });

  it('releases a failed event with bounded metadata and stable identity',
  async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: EVENT_ID }])
      .mockResolvedValueOnce([]);
    findUnique.mockResolvedValue(persistedEvent({ attempts: 3 }));
    const error = new Error('PRIVATE payload must not be persisted');
    error.name = 'KafkaConnectionError';
    send.mockRejectedValue(error);
    updateMany.mockResolvedValue({ count: 1 });

    await expect(service.flushPending()).resolves.toBe(0);

    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: EVENT_ID,
        publishedAt: null,
      }),
      data: expect.objectContaining({
        nextAttemptAt: expect.any(Date),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: 'KafkaConnectionError',
      }),
    });
    const retry = updateMany.mock.calls[0][0].data;
    expect(JSON.stringify(retry)).not.toContain('PRIVATE');
  });

  it('does not republish rows already marked by a competing retry',
  async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: EVENT_ID }])
      .mockResolvedValueOnce([]);
    findUnique
      .mockResolvedValueOnce(persistedEvent())
      .mockResolvedValueOnce({ publishedAt: new Date() });
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.flushPending()).resolves.toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('renews a lease so a second publisher cannot reclaim in-flight work',
  async () => {
    jest.useFakeTimers({
      now: new Date('2026-08-26T00:00:00.000Z'),
    });
    let leaseOwner: string | null = null;
    let leaseExpiresAt = 0;
    let publishedAt: Date | null = null;
    let renewals = 0;

    const sharedQueryRaw = jest.fn(
      async (
        _template: TemplateStringsArray,
        owner: string,
        leaseMs: number,
      ) => {
        if (publishedAt || (
          leaseOwner !== null &&
          leaseExpiresAt > Date.now()
        )) {
          return [];
        }
        leaseOwner = owner;
        leaseExpiresAt = Date.now() + leaseMs;
        return [{ id: EVENT_ID }];
      },
    );
    const sharedFindUnique = jest.fn(async (request) => {
      if (request.select) return { publishedAt };
      return persistedEvent({
        leaseOwner,
        leaseExpiresAt: new Date(leaseExpiresAt),
      });
    });
    const sharedUpdateMany = jest.fn(async (request) => {
      if (
        request.where.leaseOwner !== leaseOwner ||
        publishedAt !== null
      ) {
        return { count: 0 };
      }
      if (request.data.leaseExpiresAt) {
        leaseExpiresAt = request.data.leaseExpiresAt.getTime();
        renewals += 1;
      }
      if (request.data.publishedAt) {
        publishedAt = request.data.publishedAt;
        leaseOwner = null;
      }
      return { count: 1 };
    });
    const sharedPrisma = {
      $queryRaw: sharedQueryRaw,
      jobEventOutbox: {
        findUnique: sharedFindUnique,
        updateMany: sharedUpdateMany,
      },
    } as unknown as PrismaService;
    const values: Record<string, string> = {
      KAFKA_BROKERS: 'kafka:9092',
      KAFKA_JOB_TOPIC: 'job-events-test',
      JOB_EVENT_OUTBOX_LEASE_MS: '30000',
      JOB_EVENT_OUTBOX_BATCH_SIZE: '10',
      JOB_EVENT_OUTBOX_RETRY_BASE_MS: '100',
      JOB_EVENT_OUTBOX_RETRY_MAX_MS: '1000',
    };
    const sharedConfig = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const first = new JobEventPublisherService(
      sharedPrisma,
      sharedConfig,
    );
    const second = new JobEventPublisherService(
      sharedPrisma,
      sharedConfig,
    );

    let announceSend!: () => void;
    let releaseSend!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      announceSend = resolve;
    });
    const blockedSend = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    send.mockImplementationOnce(() => {
      announceSend();
      return blockedSend;
    });
    const firstFlush = first.flushPending();

    try {
      await sendStarted;
      const originalLeaseEnd = Date.now() + 30_000;
      await jest.advanceTimersByTimeAsync(31_000);

      await expect(second.flushPending()).resolves.toBe(0);
      expect(renewals).toBeGreaterThan(1);
      expect(leaseExpiresAt).toBeGreaterThan(originalLeaseEnd);
      expect(send).toHaveBeenCalledTimes(1);

      releaseSend();
      await expect(firstFlush).resolves.toBe(1);
    } finally {
      releaseSend();
      await firstFlush.catch(() => undefined);
      await first.onModuleDestroy();
      await second.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('fails closed on an invalid flag and never claims when disabled',
  async () => {
    const base: Record<string, string> = {
      KAFKA_BROKERS: 'kafka:9092',
      KAFKA_JOB_TOPIC: 'job-events-test',
      JOB_EVENT_OUTBOX_LEASE_MS: '30000',
    };
    const invalidConfig = {
      get: jest.fn((key: string) => ({
        ...base,
        JOB_EVENT_PUBLISHER_ENABLED: 'yes',
      })[key]),
    } as unknown as ConfigService;
    expect(() => new JobEventPublisherService(
      {} as PrismaService,
      invalidConfig,
    )).toThrow('must be true or false');

    const claim = jest.fn();
    const disabledConfig = {
      get: jest.fn((key: string) => ({
        ...base,
        JOB_EVENT_PUBLISHER_ENABLED: 'false',
      })[key]),
    } as unknown as ConfigService;
    const disabled = new JobEventPublisherService(
      { $queryRaw: claim } as unknown as PrismaService,
      disabledConfig,
    );
    disabled.onModuleInit();
    disabled.wake();

    await expect(disabled.flushPending()).resolves.toBe(0);
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await disabled.onModuleDestroy();
  });

});
