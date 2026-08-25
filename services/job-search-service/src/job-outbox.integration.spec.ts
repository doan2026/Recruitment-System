import { ConfigService } from '@nestjs/config';
import {
  JobEventAction,
  Job,
  JobStatus,
  JobType,
  Prisma,
} from '@prisma/client';
import { Consumer, Kafka } from 'kafkajs';
import { CompanyClientService } from './company-client.service';
import { CreateJobDto, UpdateJobDto } from './job.dto';
import { JobEventPublisherService } from './job-event-publisher.service';
import { JobIndexingService } from './job-indexing.service';
import { JobService } from './job.service';
import { PrismaService } from './prisma.service';

const integrationDescribe =
  process.env.JOB_INTEGRATION_TEST === '1' ? describe : describe.skip;
const RECRUITER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function config(): ConfigService {
  const values: Record<string, string> = {
    KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? 'kafka-test:9092',
    KAFKA_JOB_TOPIC: process.env.KAFKA_JOB_TOPIC ?? 'job-events',
    JOB_EVENT_OUTBOX_BATCH_SIZE: '20',
    JOB_EVENT_OUTBOX_POLL_INTERVAL_MS: '60000',
    JOB_EVENT_OUTBOX_LEASE_MS: '30000',
    JOB_EVENT_OUTBOX_RETRY_BASE_MS: '100',
    JOB_EVENT_OUTBOX_RETRY_MAX_MS: '1000',
  };
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

function createDto(): CreateJobDto {
  return {
    title: 'Backend Engineer',
    description: 'Build recruitment services',
    requirements: 'NestJS, PostgreSQL and Kafka',
    benefits: 'Remote work',
    salaryMin: 9_999_999_999_998.45,
    salaryMax: 9_999_999_999_999.45,
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 2,
    quantity: 2,
    skills: ['NestJS', 'Kafka'],
    deadline: '2099-12-31',
  };
}

integrationDescribe('Job transactional event outbox', () => {
  let prisma: PrismaService;
  let publisher: JobEventPublisherService;
  let consumer: Consumer;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const kafka = new Kafka({
      clientId: 'job-outbox-integration-admin',
      brokers: [process.env.KAFKA_BROKERS ?? 'kafka-test:9092'],
    });
    const admin = kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: [{
          topic: process.env.KAFKA_JOB_TOPIC ?? 'job-events',
          numPartitions: 3,
          replicationFactor: 1,
        }],
      });
    } finally {
      await admin.disconnect();
    }
    publisher = new JobEventPublisherService(prisma, config());
  });

  beforeEach(async () => {
    await prisma.jobEventOutbox.deleteMany();
    await prisma.job.deleteMany();
  });

  afterEach(async () => {
    await consumer?.disconnect().catch(() => undefined);
  });

  afterAll(async () => {
    await publisher.onModuleDestroy();
    await prisma.onModuleDestroy();
  });

  it('commits monotonic events, rolls back failures and publishes exact v1',
  async () => {
    const companies = {
      getRecruiterCompany: jest.fn().mockResolvedValue({
        companyId: COMPANY_ID,
        memberRole: 'OWNER',
        verifiedStatus: 'VERIFIED',
      }),
    } as unknown as CompanyClientService;
    const schedule = jest.fn().mockResolvedValue(undefined);
    const indexing = { schedule } as unknown as JobIndexingService;
    const wake = jest.fn();
    const events = {
      append: publisher.append.bind(publisher),
      wake,
    } as unknown as JobEventPublisherService;
    const service = new JobService(
      prisma,
      companies,
      indexing,
      events,
    );

    const created = await service.create(
      RECRUITER_ID,
      'Bearer integration',
      createDto(),
    );
    const updated = await service.update(
      RECRUITER_ID,
      'Bearer integration',
      created.id,
      { location: 'Da Nang' },
    );

    expect(updated.location).toBe('Da Nang');
    await expect(
      new JobService(
        prisma,
        companies,
        indexing,
        {
          append: async (
            transaction: Prisma.TransactionClient,
            job: Job,
            action: JobEventAction,
          ) => {
            await publisher.append(transaction, job, action);
            throw new Error('forced outbox failure');
          },
          wake,
        } as unknown as JobEventPublisherService,
      ).update(
        RECRUITER_ID,
        'Bearer integration',
        created.id,
        { description: 'This mutation must roll back' },
      ),
    ).rejects.toThrow('forced outbox failure');

    const afterRollback = await prisma.job.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(afterRollback.aggregateVersion).toBe(2);
    expect(afterRollback.description).toBe('Build recruitment services');
    expect(await prisma.jobEventOutbox.count()).toBe(2);

    const guardedPrisma = await prismaWithReadBarrier(prisma);
    const concurrentService = new JobService(
      guardedPrisma,
      companies,
      indexing,
      events,
    );
    const concurrentUpdates: UpdateJobDto[] = [
      { title: 'Backend Engineer A' },
      { title: 'Backend Engineer B' },
    ];
    const results = await Promise.allSettled(
      concurrentUpdates.map((dto) =>
        concurrentService.update(
          RECRUITER_ID,
          'Bearer integration',
          created.id,
          dto,
        ),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: 'JOB_STATE_CHANGED' }),
    });

    const persisted = await prisma.job.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(persisted.aggregateVersion).toBe(3);
    const pending = await prisma.jobEventOutbox.findMany({
      where: { jobId: created.id },
      orderBy: { aggregateVersion: 'asc' },
    });
    expect(pending.map((event) => event.aggregateVersion)).toEqual([1, 2, 3]);
    expect(pending.map((event) => event.action)).toEqual([
      JobEventAction.CREATED,
      JobEventAction.UPDATED,
      JobEventAction.UPDATED,
    ]);
    expect(pending[0].payload).toEqual(expect.objectContaining({
      schema_version: 1,
      aggregate_version: 1,
      requirements: 'NestJS, PostgreSQL and Kafka',
      salary_min: '9999999999998.45',
      salary_max: '9999999999999.45',
      job_type: 'FULL_TIME',
    }));

    const received: Array<{
      key: string;
      payload: Record<string, unknown>;
    }> = [];
    const kafka = new Kafka({
      clientId: 'job-outbox-integration-consumer',
      brokers: [process.env.KAFKA_BROKERS ?? 'kafka-test:9092'],
    });
    consumer = kafka.consumer({
      groupId: 'job-outbox-integration-' + Date.now(),
    });
    await consumer.connect();
    await consumer.subscribe({
      topic: process.env.KAFKA_JOB_TOPIC ?? 'job-events',
      fromBeginning: true,
    });
    const groupJoined = new Promise<void>((resolve) => {
      const unsubscribe = consumer.on(
        consumer.events.GROUP_JOIN,
        () => {
          unsubscribe();
          resolve();
        },
      );
    });
    let resolveMessages!: () => void;
    const allMessages = new Promise<void>((resolve) => {
      resolveMessages = resolve;
    });
    const consumerRun = consumer.run({
      eachMessage: async ({ message }) => {
        received.push({
          key: message.key?.toString() ?? '',
          payload: JSON.parse(message.value?.toString() ?? '{}'),
        });
        if (received.length === 3) resolveMessages();
      },
    });

    await Promise.race([
      groupJoined,
      timeout(15_000, 'Kafka consumer did not join its group'),
    ]);
    await expect(publisher.flushPending()).resolves.toBe(3);
    await Promise.race([
      allMessages,
      timeout(15_000, 'Kafka messages were not received'),
    ]);

    expect(received.map(({ key }) => key)).toEqual([
      created.id,
      created.id,
      created.id,
    ]);
    expect(received.map(({ payload }) => payload.aggregate_version)).toEqual([
      1,
      2,
      3,
    ]);
    expect(received[0].payload).toEqual(pending[0].payload);
    expect(
      await prisma.jobEventOutbox.count({
        where: { publishedAt: null },
      }),
    ).toBe(0);
    expect(schedule).toHaveBeenCalledWith(created.id);
    expect(wake).toHaveBeenCalled();
    await consumer.stop();
    await consumerRun;
  }, 45_000);
});

async function prismaWithReadBarrier(
  prisma: PrismaService,
): Promise<PrismaService> {
  let reads = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    job: {
      findUnique: async (args: Prisma.JobFindUniqueArgs) => {
        const value = await prisma.job.findUnique(args);
        reads += 1;
        if (reads === 2) release();
        await barrier;
        return value;
      },
    },
    $transaction: prisma.$transaction.bind(prisma),
  } as unknown as PrismaService;
}


function timeout(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}
