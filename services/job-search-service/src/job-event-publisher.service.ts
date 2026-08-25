import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Job,
  JobEventAction,
  JobEventOutbox,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { Kafka, Partitioners, Producer } from 'kafkajs';
import { buildJobEvent } from './job-event';
import { PrismaService } from './prisma.service';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 60_000;
const DEFAULT_KAFKA_REQUEST_TIMEOUT_MS = 3_000;
const DEFAULT_KAFKA_RETRIES = 1;
const DEFAULT_KAFKA_RETRY_MAX_MS = 500;

@Injectable()
export class JobEventPublisherService
implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobEventPublisherService.name);
  private readonly topic: string;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly kafkaRequestTimeoutMs: number;
  private readonly kafkaRetries: number;
  private readonly kafkaRetryMaxMs: number;
  private readonly workerId = randomUUID();
  private readonly producer: Producer;
  private producerConnection?: Promise<void>;
  private flushPromise?: Promise<number>;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const topic = config.get<string>('KAFKA_JOB_TOPIC')?.trim() ||
      'job-events';
    if (
      topic.length > 100 ||
      !/^[A-Za-z0-9._-]+$/.test(topic) ||
      topic === '.' ||
      topic === '..'
    ) {
      throw new Error(
        'KAFKA_JOB_TOPIC must be a valid Kafka topic of 1 to 100 characters',
      );
    }
    this.topic = topic;
    this.pollIntervalMs = positiveInteger(
      config,
      'JOB_EVENT_OUTBOX_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
      100,
      300_000,
    );
    this.leaseMs = positiveInteger(
      config,
      'JOB_EVENT_OUTBOX_LEASE_MS',
      DEFAULT_LEASE_MS,
      1_000,
      900_000,
    );
    this.batchSize = positiveInteger(
      config,
      'JOB_EVENT_OUTBOX_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
      1,
      1_000,
    );
    this.retryBaseMs = positiveInteger(
      config,
      'JOB_EVENT_OUTBOX_RETRY_BASE_MS',
      DEFAULT_RETRY_BASE_MS,
      100,
      300_000,
    );
    this.retryMaxMs = positiveInteger(
      config,
      'JOB_EVENT_OUTBOX_RETRY_MAX_MS',
      DEFAULT_RETRY_MAX_MS,
      this.retryBaseMs,
      3_600_000,
    );
    this.kafkaRequestTimeoutMs = positiveInteger(
      config,
      'JOB_EVENT_KAFKA_REQUEST_TIMEOUT_MS',
      DEFAULT_KAFKA_REQUEST_TIMEOUT_MS,
      500,
      30_000,
    );
    this.kafkaRetries = positiveInteger(
      config,
      'JOB_EVENT_KAFKA_RETRIES',
      DEFAULT_KAFKA_RETRIES,
      1,
      3,
    );
    this.kafkaRetryMaxMs = positiveInteger(
      config,
      'JOB_EVENT_KAFKA_RETRY_MAX_MS',
      DEFAULT_KAFKA_RETRY_MAX_MS,
      100,
      5_000,
    );
    const minimumLeaseMs =
      this.kafkaRequestTimeoutMs * (this.kafkaRetries + 1) * 4 +
      this.kafkaRetryMaxMs * this.kafkaRetries * 2;
    if (this.leaseMs < minimumLeaseMs) {
      throw new Error(
        'JOB_EVENT_OUTBOX_LEASE_MS must be at least ' +
          minimumLeaseMs +
          ' for the configured Kafka timeout and retries',
      );
    }

    const kafkaRetry = {
      retries: this.kafkaRetries,
      initialRetryTime: Math.min(300, this.kafkaRetryMaxMs),
      maxRetryTime: this.kafkaRetryMaxMs,
    };

    const brokers = (config.get<string>('KAFKA_BROKERS') ?? 'kafka:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (!brokers.length) {
      throw new Error('KAFKA_BROKERS must contain at least one broker');
    }
    this.producer = new Kafka({
      clientId: 'job-search-service-outbox',
      brokers,
      connectionTimeout: this.kafkaRequestTimeoutMs,
      authenticationTimeout: this.kafkaRequestTimeoutMs,
      requestTimeout: this.kafkaRequestTimeoutMs,
      enforceRequestTimeout: true,
      retry: kafkaRetry,
    }).producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      retry: kafkaRetry,
      allowAutoTopicCreation: false,
      maxInFlightRequests: 1,
    });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => this.wake(), this.pollIntervalMs);
    this.timer.unref();
    this.wake();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flushPromise?.catch(() => undefined);
    if (this.producerConnection) {
      await this.producer.disconnect().catch(() => undefined);
    }
  }

  async append(
    transaction: Prisma.TransactionClient,
    job: Job,
    action: JobEventAction,
  ): Promise<string> {
    const eventId = randomUUID();
    const occurredAt = new Date();
    const payload = buildJobEvent(job, action, eventId, occurredAt);
    await transaction.jobEventOutbox.create({
      data: {
        id: eventId,
        jobId: job.id,
        aggregateVersion: job.aggregateVersion,
        action,
        topic: this.topic,
        eventKey: job.id,
        payload: payload as unknown as Prisma.InputJsonObject,
        nextAttemptAt: occurredAt,
        createdAt: occurredAt,
      },
    });
    return eventId;
  }

  wake(): void {
    void this.flushPending().catch((error: unknown) => {
      this.logger.warn(
        `Job event outbox flush deferred (${errorName(error)})`,
      );
    });
  }

  async flushPending(): Promise<number> {
    if (this.flushPromise) return this.flushPromise;
    const current = this.drain();
    this.flushPromise = current;
    try {
      return await current;
    } finally {
      if (this.flushPromise === current) this.flushPromise = undefined;
    }
  }

  private async drain(): Promise<number> {
    let published = 0;
    for (let index = 0; index < this.batchSize; index += 1) {
      const event = await this.claimNext();
      if (!event) break;
      try {
        await this.publish(event);
        await this.markPublished(event);
        published += 1;
      } catch (error) {
        await this.releaseForRetry(event, error);
        this.logger.warn(
          `Job event ${event.id} publish deferred (${errorName(error)})`,
        );
      }
    }
    return published;
  }

  private async claimNext(): Promise<JobEventOutbox | null> {
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH candidate AS (
        SELECT pending."event_id"
        FROM "job"."job_event_outbox" AS pending
        WHERE pending."published_at" IS NULL
          AND pending."next_attempt_at" <= CURRENT_TIMESTAMP
          AND (
            pending."lease_expires_at" IS NULL
            OR pending."lease_expires_at" < CURRENT_TIMESTAMP
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "job"."job_event_outbox" AS earlier
            WHERE earlier."job_id" = pending."job_id"
              AND earlier."aggregate_version" <
                pending."aggregate_version"
              AND earlier."published_at" IS NULL
          )
        ORDER BY pending."created_at", pending."event_id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "job"."job_event_outbox" AS claimed
      SET "lease_owner" = ${this.workerId},
          "lease_expires_at" = CURRENT_TIMESTAMP +
            (${this.leaseMs} * INTERVAL '1 millisecond'),
          "attempts" = claimed."attempts" + 1
      FROM candidate
      WHERE claimed."event_id" = candidate."event_id"
      RETURNING claimed."event_id" AS "id"
    `;
    const id = claimed[0]?.id;
    if (!id) return null;
    return this.prisma.jobEventOutbox.findUnique({ where: { id } });
  }

  private async publish(event: JobEventOutbox): Promise<void> {
    await this.renewLease(event);
    const stopHeartbeat = this.startLeaseHeartbeat(event);
    try {
      await this.ensureProducer();
      await this.producer.send({
        topic: event.topic,
        timeout: this.kafkaRequestTimeoutMs,
        messages: [{
          key: event.eventKey,
          value: JSON.stringify(event.payload),
        }],
      });
    } finally {
      await stopHeartbeat();
    }
  }

  private startLeaseHeartbeat(
    event: JobEventOutbox,
  ): () => Promise<void> {
    let renewal: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (renewal) return;
      const current = this.renewLease(event);
      renewal = current;
      void current
        .catch((error: unknown) => {
          this.logger.warn(
            `Job event ${event.id} lease renewal failed (${errorName(error)})`,
          );
        })
        .finally(() => {
          if (renewal === current) renewal = undefined;
        });
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    timer.unref();

    return async () => {
      clearInterval(timer);
      await renewal?.catch(() => undefined);
    };
  }

  private async renewLease(event: JobEventOutbox): Promise<void> {
    const result = await this.prisma.jobEventOutbox.updateMany({
      where: {
        id: event.id,
        leaseOwner: this.workerId,
        publishedAt: null,
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + this.leaseMs),
      },
    });
    if (result.count !== 1) {
      throw new Error('OUTBOX_LEASE_LOST_BEFORE_PUBLISH');
    }
  }

  private async markPublished(event: JobEventOutbox): Promise<void> {
    const result = await this.prisma.jobEventOutbox.updateMany({
      where: {
        id: event.id,
        leaseOwner: this.workerId,
        publishedAt: null,
      },
      data: {
        publishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    if (result.count === 1) return;

    const current = await this.prisma.jobEventOutbox.findUnique({
      where: { id: event.id },
      select: { publishedAt: true },
    });
    if (!current?.publishedAt) {
      throw new Error('OUTBOX_LEASE_LOST_AFTER_PUBLISH');
    }
  }

  private async releaseForRetry(
    event: JobEventOutbox,
    error: unknown,
  ): Promise<void> {
    const exponent = Math.max(0, Math.min(event.attempts - 1, 20));
    const delay = Math.min(
      this.retryBaseMs * (2 ** exponent),
      this.retryMaxMs,
    );
    await this.prisma.jobEventOutbox.updateMany({
      where: {
        id: event.id,
        leaseOwner: this.workerId,
        publishedAt: null,
      },
      data: {
        nextAttemptAt: new Date(Date.now() + delay),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: errorName(error),
      },
    });
  }

  private async ensureProducer(): Promise<void> {
    if (!this.producerConnection) {
      const attempt = this.producer.connect();
      this.producerConnection = attempt;
      void attempt.catch(() => {
        if (this.producerConnection === attempt) {
          this.producerConnection = undefined;
        }
      });
    }
    await this.producerConnection;
  }
}

function positiveInteger(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) {
    return error.name.slice(0, 100);
  }
  return 'UnknownError';
}
