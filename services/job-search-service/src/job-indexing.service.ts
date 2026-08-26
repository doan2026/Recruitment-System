import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { Job, JobIndexSync, JobStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Job as QueueJob, Queue, Worker } from 'bullmq';
import { CompanyClientService } from './company-client.service';
import { PrismaService } from './prisma.service';

interface JobIndexTask {
  jobId: string;
  aggregateVersion: number;
  generation: number;
}

interface ClaimedIndexSync {
  jobId: string;
  aggregateVersion: number;
  generation: number;
  dispatchAttempts: number;
}

interface JobIndexDocument {
  jobId: string;
  aggregateVersion: number;
  indexGeneration: number;
  searchable: boolean;
  status?: JobStatus;
  companyId?: string;
  companyName?: string;
  title?: string;
  description?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  isNegotiable?: boolean;
  currency?: string;
  location?: string;
  jobType?: string;
  experienceYears?: number;
  skills?: string[];
  deadline?: string;
  publishedAt?: string | null;
}

interface ValidatedIndex {
  concreteIndex: string;
  indexUuid: string;
  baselineComplete: boolean;
}

interface IndexMappingField {
  type?: string;
  analyzer?: string;
  index?: boolean;
  doc_values?: boolean;
  fields?: Record<string, IndexMappingField>;
}

interface IndexMappingContract {
  dynamic?: string | boolean;
  _meta?: Record<string, unknown>;
  properties?: Record<string, IndexMappingField>;
}

interface IndexAnalysisContract {
  analyzer?: {
    vietnamese_text?: {
      type?: string;
      tokenizer?: string;
      filter?: unknown;
      char_filter?: unknown;
    };
  };
}

export interface JobIndexFailure {
  jobId: string;
  aggregateVersion: number;
  generation: number;
  processingAttempts: number;
  lastError: string;
  failedAt: string;
}

type RedisConnection = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
  maxRetriesPerRequest?: number | null;
  enableOfflineQueue?: boolean;
  connectTimeout?: number;
  commandTimeout?: number;
  retryStrategy?: (attempt: number) => number | null;
};

const DEFAULT_QUEUE_NAME = 'job-search-indexing';
const DEFAULT_ATTEMPTS = 8;
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_RECONCILE_MS = 60_000;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_REDIS_COMMAND_TIMEOUT_MS = 2_000;
const DISPATCH_RETRY_MAX_MS = 60_000;
const INDEX_PROJECTION_VERSION = 3;

@Injectable()
export class JobIndexingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobIndexingService.name);
  private readonly elastic: Client;
  private readonly index: string;
  private readonly queueConnection: RedisConnection;
  private readonly workerConnection: RedisConnection;
  private queue: Queue<JobIndexTask>;
  private readonly queueName: string;
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly reconcileMs: number;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly redisCommandTimeoutMs: number;
  private readonly dispatcherId = randomUUID();
  private worker?: Worker<JobIndexTask>;
  private timer?: NodeJS.Timeout;
  private flushPromise?: Promise<number>;
  private indexReady?: Promise<void>;
  private baselineCheckPromise?: Promise<void>;
  private baselineIndex?: string;
  private baselineIndexUuid?: string;
  private baselineScanComplete = false;
  private searchReady = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyClientService,
    config: ConfigService,
  ) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) throw new Error('REDIS_URL is required');
    const connection = this.redisConnection(redisUrl);
    this.redisCommandTimeoutMs = positiveInteger(
      config,
      'JOB_INDEX_REDIS_COMMAND_TIMEOUT_MS',
      DEFAULT_REDIS_COMMAND_TIMEOUT_MS,
      100,
      30_000,
    );
    this.queueConnection = {
      ...connection,
      maxRetriesPerRequest: 1,
      connectTimeout: this.redisCommandTimeoutMs,
      commandTimeout: this.redisCommandTimeoutMs,
      retryStrategy: () => null,
    };
    this.workerConnection = {
      ...connection,
      maxRetriesPerRequest: null,
      connectTimeout: this.redisCommandTimeoutMs,
      retryStrategy: redisRetryDelay,
    };
    this.index = config.get<string>('ELASTICSEARCH_INDEX')?.trim() ||
      'job_index_v3';
    if (!/^[a-z0-9][a-z0-9._-]{0,254}$/.test(this.index)) {
      throw new Error(
        'ELASTICSEARCH_INDEX must be one lowercase index or alias',
      );
    }
    this.queueName = config.get<string>('JOB_INDEX_QUEUE_NAME')?.trim() ||
      DEFAULT_QUEUE_NAME;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(this.queueName)) {
      throw new Error(
        'JOB_INDEX_QUEUE_NAME must contain only letters, digits, _ or -',
      );
    }
    this.attempts = positiveInteger(
      config,
      'JOB_INDEX_ATTEMPTS',
      DEFAULT_ATTEMPTS,
      1,
      20,
    );
    this.backoffMs = positiveInteger(
      config,
      'JOB_INDEX_BACKOFF_MS',
      DEFAULT_BACKOFF_MS,
      10,
      300_000,
    );
    this.concurrency = positiveInteger(
      config,
      'JOB_INDEX_CONCURRENCY',
      DEFAULT_CONCURRENCY,
      1,
      100,
    );
    this.pollIntervalMs = positiveInteger(
      config,
      'JOB_INDEX_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
      25,
      300_000,
    );
    this.reconcileMs = positiveInteger(
      config,
      'JOB_INDEX_RECONCILE_MS',
      DEFAULT_RECONCILE_MS,
      100,
      3_600_000,
    );
    this.leaseMs = positiveInteger(
      config,
      'JOB_INDEX_LEASE_MS',
      DEFAULT_LEASE_MS,
      100,
      900_000,
    );
    this.batchSize = positiveInteger(
      config,
      'JOB_INDEX_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
      1,
      1_000,
    );
    const configuredTimeout = Number(
      config.get<string>('ELASTICSEARCH_REQUEST_TIMEOUT_MS') ?? '5000',
    );
    this.elastic = new Client({
      node: config.get<string>('ELASTICSEARCH_NODE') ??
        'http://elasticsearch:9200',
      requestTimeout:
        Number.isFinite(configuredTimeout) && configuredTimeout > 0
          ? configuredTimeout
          : 5000,
      maxRetries: 0,
    });
    this.queue = this.createQueue();
  }

  private createQueue(): Queue<JobIndexTask> {
    const queue = new Queue<JobIndexTask>(this.queueName, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: this.attempts,
        backoff: { type: 'exponential', delay: this.backoffMs },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    });
    queue.on('error', (error) =>
      this.logger.error(`BullMQ queue error (${errorName(error)})`),
    );
    return queue;
  }

  onModuleInit(): void {
    this.worker = new Worker<JobIndexTask>(
      this.queueName,
      (job) => this.process(job),
      { connection: this.workerConnection, concurrency: this.concurrency },
    );
    this.worker.on('failed', (job, error) => {
      const attempt = job?.attemptsMade ?? 0;
      const total = Number(job?.opts.attempts ?? this.attempts);
      const log = attempt >= total ? this.logger.error.bind(this.logger) :
        this.logger.warn.bind(this.logger);
      log(
        `Index task ${job?.id ?? 'unknown'} failed ` +
          `(${errorName(error)}, attempt ${attempt}/${total})`,
      );
    });
    this.worker.on('error', (error) =>
      this.logger.error(`BullMQ worker error (${errorName(error)})`),
    );
    this.timer = setInterval(() => this.wake(), this.pollIntervalMs);
    this.timer.unref();
    void this.ensureIndex()
      .then(() => this.refreshBaselineReadiness())
      .catch((error: unknown) => {
        this.logger.warn(
          `Elasticsearch index initialization deferred (${errorName(error)})`,
        );
      });
    this.wake();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.flushPromise?.catch(() => undefined);
    await this.worker?.close(true);
    await this.queue.close();
    await this.elastic.close();
  }

  async append(
    transaction: Prisma.TransactionClient,
    job: Job,
  ): Promise<void> {
    await this.recordDesiredState(transaction, job.id, job.aggregateVersion);
  }

  isSearchReady(): boolean {
    return this.searchReady;
  }

  wake(): void {
    if (this.stopping) return;
    void this.ensureIndex()
      .then(() => this.refreshBaselineReadiness())
      .catch((error: unknown) => {
        this.logger.warn(
          `Elasticsearch index initialization deferred (${errorName(error)})`,
        );
      });
    void this.flushPending().catch((error: unknown) => {
      this.logger.warn(`Index sync flush deferred (${errorName(error)})`);
    });
  }

  async flushPending(): Promise<number> {
    if (this.stopping) return 0;
    if (this.flushPromise) return this.flushPromise;
    const current = this.drain();
    this.flushPromise = current;
    try {
      return await current;
    } finally {
      if (this.flushPromise === current) this.flushPromise = undefined;
    }
  }

  async reindexAll(): Promise<number> {
    let cursor: string | undefined;
    let queued = 0;
    do {
      if (this.stopping) break;
      const jobs = await this.prisma.job.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, aggregateVersion: true },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!jobs.length) break;
      await this.recordDesiredStates(this.prisma, jobs);
      queued += jobs.length;
      cursor = jobs.at(-1)?.id;
    } while (cursor);
    if (queued) this.wake();
    return queued;
  }

  private async recordDesiredState(
    transaction: Pick<Prisma.TransactionClient, '$executeRaw'>,
    jobId: string,
    aggregateVersion: number,
  ): Promise<void> {
    await this.recordDesiredStates(transaction, [{
      id: jobId,
      aggregateVersion,
    }]);
  }

  private async recordDesiredStates(
    transaction: Pick<Prisma.TransactionClient, '$executeRaw'>,
    jobs: ReadonlyArray<{ id: string; aggregateVersion: number }>,
  ): Promise<void> {
    if (!jobs.length) return;
    const desiredStates = Prisma.join(jobs.map((job) => Prisma.sql`
      (${job.id}::uuid, ${job.aggregateVersion})
    `));
    await transaction.$executeRaw`
      INSERT INTO "job"."job_index_sync" AS current (
        "job_id",
        "aggregate_version",
        "generation",
        "dispatch_attempts",
        "processing_attempts",
        "next_attempt_at",
        "updated_at"
      ) SELECT
        desired."job_id",
        desired."aggregate_version",
        1,
        0,
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM (VALUES ${desiredStates}) AS desired(
        "job_id", "aggregate_version"
      )
      ON CONFLICT ("job_id") DO UPDATE
      SET "aggregate_version" = EXCLUDED."aggregate_version",
          "generation" = current."generation" + 1,
          "dispatch_attempts" = 0,
          "processing_attempts" = 0,
          "next_attempt_at" = CURRENT_TIMESTAMP,
          "lease_owner" = NULL,
          "lease_expires_at" = NULL,
          "completed_at" = NULL,
          "failed_at" = NULL,
          "last_error" = NULL,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE current."aggregate_version" <= EXCLUDED."aggregate_version"
    `;
  }

  async listFailures(limit = 100): Promise<JobIndexFailure[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    const rows = await this.prisma.jobIndexSync.findMany({
      where: { failedAt: { not: null } },
      orderBy: { failedAt: 'asc' },
      take: safeLimit,
    });
    return rows.flatMap((row) => row.failedAt ? [{
      jobId: row.jobId,
      aggregateVersion: row.aggregateVersion,
      generation: row.generation,
      processingAttempts: row.processingAttempts,
      lastError: row.lastError ?? 'INDEXING_FAILED',
      failedAt: row.failedAt.toISOString(),
    }] : []);
  }

  async retryFailures(): Promise<number> {
    const result = await this.prisma.jobIndexSync.updateMany({
      where: { failedAt: { not: null } },
      data: {
        generation: { increment: 1 },
        dispatchAttempts: 0,
        processingAttempts: 0,
        nextAttemptAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: null,
        failedAt: null,
        lastError: null,
      },
    });
    if (result.count) this.wake();
    return result.count;
  }

  private async drain(): Promise<number> {
    let dispatched = 0;
    for (let index = 0; index < this.batchSize; index += 1) {
      if (this.stopping) break;
      const sync = await this.claimNext();
      if (!sync) break;
      if (this.stopping) {
        await this.releaseClaimForShutdown(sync);
        break;
      }
      try {
        await withTimeout(
          this.dispatch(sync),
          this.redisCommandTimeoutMs,
        );
        dispatched += 1;
      } catch (error) {
        await this.releaseForRetry(sync);
        await this.resetQueue();
        this.logger.warn(
          `Index sync ${sync.jobId} dispatch deferred (${errorName(error)})`,
        );
      }
    }
    return dispatched;
  }

  private async resetQueue(): Promise<void> {
    const failedQueue = this.queue;
    await withTimeout(
      failedQueue.close(),
      this.redisCommandTimeoutMs,
    ).catch(() => failedQueue.disconnect().catch(() => undefined));
    if (!this.stopping && this.queue === failedQueue) {
      this.queue = this.createQueue();
    }
  }

  private async claimNext(): Promise<ClaimedIndexSync | null> {
    const claimed = await this.prisma.$queryRaw<ClaimedIndexSync[]>`
      WITH candidate AS (
        SELECT pending."job_id"
        FROM "job"."job_index_sync" AS pending
        WHERE pending."completed_at" IS NULL
          AND pending."failed_at" IS NULL
          AND pending."next_attempt_at" <= CURRENT_TIMESTAMP
          AND (
            pending."lease_expires_at" IS NULL
            OR pending."lease_expires_at" < CURRENT_TIMESTAMP
          )
        ORDER BY pending."next_attempt_at", pending."updated_at",
          pending."job_id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "job"."job_index_sync" AS claimed
      SET "lease_owner" = ${this.dispatcherId},
          "lease_expires_at" = CURRENT_TIMESTAMP +
            (${this.leaseMs} * INTERVAL '1 millisecond'),
          "dispatch_attempts" = claimed."dispatch_attempts" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      FROM candidate
      WHERE claimed."job_id" = candidate."job_id"
      RETURNING claimed."job_id" AS "jobId",
        claimed."aggregate_version" AS "aggregateVersion",
        claimed."generation" AS "generation",
        claimed."dispatch_attempts" AS "dispatchAttempts"
    `;
    return claimed[0] ?? null;
  }

  private async releaseClaimForShutdown(
    sync: ClaimedIndexSync,
  ): Promise<void> {
    await this.prisma.jobIndexSync.updateMany({
      where: {
        jobId: sync.jobId,
        aggregateVersion: sync.aggregateVersion,
        generation: sync.generation,
        leaseOwner: this.dispatcherId,
        completedAt: null,
        failedAt: null,
      },
      data: {
        dispatchAttempts: { decrement: 1 },
        nextAttemptAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async dispatch(sync: ClaimedIndexSync): Promise<void> {
    const task: JobIndexTask = {
      jobId: sync.jobId,
      aggregateVersion: sync.aggregateVersion,
      generation: sync.generation,
    };
    const options = { jobId: this.queueJobId(task) };
    let queued = await this.queue.add('sync-job', task, options);
    const state = await queued.getState();
    if (state === 'failed') {
      await queued.retry();
    } else if (state === 'completed') {
      await queued.remove();
      queued = await this.queue.add('sync-job', task, options);
    }
    await this.prisma.jobIndexSync.updateMany({
      where: {
        jobId: sync.jobId,
        aggregateVersion: sync.aggregateVersion,
        generation: sync.generation,
        leaseOwner: this.dispatcherId,
        completedAt: null,
        failedAt: null,
      },
      data: {
        nextAttemptAt: new Date(Date.now() + this.reconcileMs),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  private async releaseForRetry(sync: ClaimedIndexSync): Promise<void> {
    const exponent = Math.max(0, Math.min(sync.dispatchAttempts - 1, 20));
    const delay = Math.min(
      this.backoffMs * (2 ** exponent),
      DISPATCH_RETRY_MAX_MS,
    );
    await this.prisma.jobIndexSync.updateMany({
      where: {
        jobId: sync.jobId,
        aggregateVersion: sync.aggregateVersion,
        generation: sync.generation,
        leaseOwner: this.dispatcherId,
        completedAt: null,
        failedAt: null,
      },
      data: {
        nextAttemptAt: new Date(Date.now() + delay),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: 'REDIS_ENQUEUE_FAILED',
      },
    });
  }

  private async process(queueJob: QueueJob<JobIndexTask>): Promise<void> {
    const task = queueJob.data;
    try {
      const claimed = await this.prisma.jobIndexSync.updateMany({
        where: {
          jobId: task.jobId,
          aggregateVersion: task.aggregateVersion,
          generation: task.generation,
          completedAt: null,
          failedAt: null,
        },
        data: { processingAttempts: { increment: 1 } },
      });
      if (claimed.count !== 1) return;

      const job = await this.prisma.job.findUnique({
        where: { id: task.jobId },
      });
      if (job && job.aggregateVersion < task.aggregateVersion) {
        throw new Error('JOB_SOURCE_VERSION_BEHIND');
      }
      if (job && job.aggregateVersion > task.aggregateVersion) return;
      await this.synchronize(task, job);
      await this.prisma.jobIndexSync.updateMany({
        where: {
          jobId: task.jobId,
          aggregateVersion: task.aggregateVersion,
          generation: task.generation,
          failedAt: null,
        },
        data: {
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const code = failureCode(error);
      if (this.isFinalAttempt(queueJob)) {
        await this.prisma.jobIndexSync.updateMany({
          where: {
            jobId: task.jobId,
            aggregateVersion: task.aggregateVersion,
            generation: task.generation,
            completedAt: null,
          },
          data: {
            failedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: code,
          },
        }).catch(() => undefined);
      }
      const safeError = new Error(code);
      safeError.name = code;
      throw safeError;
    }
  }

  private async synchronize(
    task: JobIndexTask,
    job: Job | null,
  ): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const searchable = Boolean(
      job &&
      job.status === JobStatus.PUBLISHED &&
      job.deadline.getTime() >= today.getTime(),
    );
    let document: JobIndexDocument;
    if (job && searchable) {
      const companyName = await this.companies.getPublicCompanyName(
        job.companyId,
      );
      document = {
        jobId: job.id,
        aggregateVersion: task.aggregateVersion,
        indexGeneration: task.generation,
        searchable: true,
        status: job.status,
        companyId: job.companyId,
        companyName,
        title: job.title,
        description: job.description,
        salaryMin: job.salaryMin?.toNumber() ?? null,
        salaryMax: job.salaryMax?.toNumber() ?? null,
        isNegotiable: job.isNegotiable,
        currency: job.currency,
        location: job.location,
        jobType: job.jobType,
        experienceYears: job.experienceYears,
        skills: job.skills,
        deadline: job.deadline.toISOString().slice(0, 10),
        publishedAt: job.publishedAt?.toISOString() ?? null,
      };
    } else {
      document = {
        jobId: task.jobId,
        aggregateVersion: task.aggregateVersion,
        indexGeneration: task.generation,
        searchable: false,
        ...(job ? { status: job.status } : {}),
      };
    }
    await this.writeVersionedDocument(task, document);
  }

  private async writeVersionedDocument(
    task: JobIndexTask,
    document: JobIndexDocument,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.ensureIndex();
      try {
        await this.elastic.update({
          index: this.index,
          id: task.jobId,
          retry_on_conflict: 3,
          script: {
            lang: 'painless',
            source: `
              if (
                !ctx._source.containsKey('aggregateVersion') ||
                ctx._source.aggregateVersion < params.aggregateVersion ||
                (
                  ctx._source.aggregateVersion == params.aggregateVersion &&
                  (
                    !ctx._source.containsKey('indexGeneration') ||
                    ctx._source.indexGeneration < params.indexGeneration
                  )
                )
              ) {
                ctx._source = params.document;
              } else {
                ctx.op = 'noop';
              }
            `,
            params: {
              aggregateVersion: task.aggregateVersion,
              indexGeneration: task.generation,
              document,
            },
          },
          upsert: document,
        });
        return;
      } catch (error) {
        if (attempt === 0 && isIndexNotFound(error)) {
          this.indexReady = undefined;
          continue;
        }
        throw error;
      }
    }
  }

  private isFinalAttempt(queueJob: QueueJob<JobIndexTask>): boolean {
    const total = Number(queueJob.opts.attempts ?? this.attempts);
    return queueJob.attemptsMade + 1 >= total;
  }

  private queueJobId(task: JobIndexTask): string {
    return `idx-${task.jobId}-${task.aggregateVersion}-${task.generation}`;
  }

  private async ensureIndex(): Promise<void> {
    if (!this.indexReady) {
      const attempt = this.createIndexIfMissing();
      this.indexReady = attempt;
      void attempt.catch(() => {
        if (this.indexReady === attempt) this.indexReady = undefined;
      });
    }
    await this.indexReady;
  }

  private async createIndexIfMissing(): Promise<void> {
    if (await this.elastic.indices.exists({ index: this.index })) {
      const validated = await this.validateIndexMapping();
      await this.prepareBaseline(validated);
      return;
    }
    try {
      await this.elastic.indices.create({
        index: this.index,
        settings: {
          analysis: {
            analyzer: {
              vietnamese_text: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'asciifolding'],
              },
            },
          },
        },
        mappings: {
          dynamic: 'strict',
          _meta: { projectionVersion: INDEX_PROJECTION_VERSION },
          properties: {
            jobId: { type: 'keyword' },
            aggregateVersion: { type: 'long' },
            indexGeneration: { type: 'integer' },
            searchable: { type: 'boolean' },
            companyId: { type: 'keyword' },
            companyName: {
              type: 'text',
              analyzer: 'vietnamese_text',
              fields: { keyword: { type: 'keyword' } },
            },
            title: { type: 'text', analyzer: 'vietnamese_text' },
            description: { type: 'text', analyzer: 'vietnamese_text' },
            salaryMin: { type: 'double' },
            salaryMax: { type: 'double' },
            isNegotiable: { type: 'boolean' },
            currency: { type: 'keyword' },
            location: {
              type: 'text',
              analyzer: 'vietnamese_text',
              fields: { keyword: { type: 'keyword' } },
            },
            jobType: { type: 'keyword' },
            experienceYears: { type: 'integer' },
            skills: {
              type: 'text',
              analyzer: 'vietnamese_text',
              fields: { keyword: { type: 'keyword' } },
            },
            deadline: { type: 'date' },
            status: { type: 'keyword' },
            publishedAt: { type: 'date' },
          },
        },
      });
    } catch (error) {
      if (!isIndexAlreadyExists(error)) throw error;
    }
    const validated = await this.validateIndexMapping();
    await this.prepareBaseline(validated);
  }

  private async prepareBaseline(
    validated: ValidatedIndex,
  ): Promise<void> {
    if (validated.baselineComplete) {
      this.baselineIndex = undefined;
      this.baselineIndexUuid = undefined;
      this.baselineScanComplete = false;
      this.searchReady = true;
      return;
    }

    this.searchReady = false;
    this.baselineIndex = validated.concreteIndex;
    this.baselineIndexUuid = validated.indexUuid;
    this.baselineScanComplete = false;
    const queued = await this.reindexAll();
    this.baselineScanComplete = true;
    if (queued) {
      this.logger.log(
        'Queued existing jobs for Elasticsearch baseline: ' + String(queued),
      );
    }
    await this.refreshBaselineReadiness();
  }

  private async refreshBaselineReadiness(): Promise<void> {
    if (
      this.stopping ||
      this.searchReady ||
      !this.baselineIndex ||
      !this.baselineIndexUuid ||
      !this.baselineScanComplete
    ) {
      return;
    }
    if (this.baselineCheckPromise) return this.baselineCheckPromise;

    const concreteIndex = this.baselineIndex;
    const indexUuid = this.baselineIndexUuid;
    const check = this.completeBaselineIfReady(concreteIndex, indexUuid);
    this.baselineCheckPromise = check;
    try {
      await check;
    } finally {
      if (this.baselineCheckPromise === check) {
        this.baselineCheckPromise = undefined;
      }
    }
  }

  private async completeBaselineIfReady(
    concreteIndex: string,
    indexUuid: string,
  ): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ pending: number }>>`
      SELECT COUNT(*)::integer AS "pending"
      FROM "job"."jobs" AS source
      LEFT JOIN "job"."job_index_sync" AS sync
        ON sync."job_id" = source."id"
      WHERE sync."job_id" IS NULL
        OR sync."aggregate_version" <> source."aggregate_version"
        OR sync."completed_at" IS NULL
        OR sync."failed_at" IS NOT NULL
    `;
    const pending = rows[0]?.pending ?? 1;
    if (
      pending !== 0 ||
      this.baselineIndex !== concreteIndex ||
      this.baselineIndexUuid !== indexUuid
    ) return;

    let current: ValidatedIndex;
    try {
      await this.elastic.indices.refresh({ index: concreteIndex });
      current = await this.validateIndexMapping();
    } catch (error) {
      if (isIndexNotFound(error)) {
        this.invalidateBaselineTarget();
        return;
      }
      throw error;
    }
    if (
      current.concreteIndex !== concreteIndex ||
      current.indexUuid !== indexUuid
    ) {
      this.invalidateBaselineTarget();
      return;
    }

    await this.elastic.indices.putMapping({
      index: concreteIndex,
      _meta: {
        projectionVersion: INDEX_PROJECTION_VERSION,
        baselineVersion: INDEX_PROJECTION_VERSION,
        baselineIndexUuid: indexUuid,
      },
    });
    let completed: ValidatedIndex;
    try {
      completed = await this.validateIndexMapping();
    } catch (error) {
      if (isIndexNotFound(error)) {
        this.invalidateBaselineTarget();
        return;
      }
      throw error;
    }
    if (
      !completed.baselineComplete ||
      completed.concreteIndex !== concreteIndex ||
      completed.indexUuid !== indexUuid ||
      this.baselineIndex !== concreteIndex ||
      this.baselineIndexUuid !== indexUuid
    ) {
      this.invalidateBaselineTarget();
      return;
    }
    this.searchReady = true;
    this.baselineIndex = undefined;
    this.baselineIndexUuid = undefined;
    this.baselineScanComplete = false;
    this.logger.log(
      'Elasticsearch baseline is complete for ' + concreteIndex,
    );
  }

  private async validateIndexMapping(): Promise<ValidatedIndex> {
    const mappings = await this.elastic.indices.getMapping({
      index: this.index,
    });
    const entries = Object.entries(mappings);
    if (entries.length !== 1) this.incompatibleIndex();

    const [concreteIndex, configured] = entries[0];
    const current = configured.mappings as IndexMappingContract | undefined;
    const settings = await this.elastic.indices.getSettings({
      index: concreteIndex,
    });
    const indexSettings = (
      settings[concreteIndex]?.settings as unknown as {
        index?: {
          uuid?: string;
          analysis?: IndexAnalysisContract;
        };
      } | undefined
    )?.index;
    const analysis = indexSettings?.analysis;
    const indexUuid = indexSettings?.uuid;

    if (
      !indexUuid ||
      !isCompatibleIndexMapping(current) ||
      !isCompatibleVietnameseAnalyzer(analysis)
    ) {
      this.incompatibleIndex();
    }
    return {
      concreteIndex,
      indexUuid,
      baselineComplete:
        current?._meta?.baselineVersion === INDEX_PROJECTION_VERSION &&
        current?._meta?.baselineIndexUuid === indexUuid,
    };
  }

  private incompatibleIndex(): never {
    const error = new Error('ELASTICSEARCH_INDEX_INCOMPATIBLE');
    error.name = 'ELASTICSEARCH_INDEX_INCOMPATIBLE';
    throw error;
  }

  private invalidateBaselineTarget(): void {
    this.searchReady = false;
    this.baselineIndex = undefined;
    this.baselineIndexUuid = undefined;
    this.baselineScanComplete = false;
    this.indexReady = undefined;
  }

  private redisConnection(redisUrl: string): RedisConnection {
    let parsed: URL;
    try {
      parsed = new URL(redisUrl);
    } catch {
      throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
    }
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
      throw new Error('REDIS_URL must use redis:// or rediss://');
    }
    const port = parsed.port ? Number(parsed.port) : 6379;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error('REDIS_URL port must be between 1 and 65535');
    }
    const dbText = parsed.pathname.replace(/^\//, '');
    const db = dbText ? Number(dbText) : undefined;
    if (
      db !== undefined &&
      (!Number.isSafeInteger(db) || db < 0 || db > 1_024)
    ) {
      throw new Error('REDIS_URL database must be between 0 and 1024');
    }
    return {
      host: parsed.hostname,
      port,
      ...(parsed.username
        ? { username: decodeURIComponent(parsed.username) }
        : {}),
      ...(parsed.password
        ? { password: decodeURIComponent(parsed.password) }
        : {}),
      ...(db !== undefined ? { db } : {}),
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }
}

function isCompatibleIndexMapping(
  mapping: IndexMappingContract | undefined,
): boolean {
  const properties = mapping?.properties;
  return mapping?.dynamic === 'strict' &&
    mapping._meta?.projectionVersion === INDEX_PROJECTION_VERSION &&
    hasMapping(properties, 'jobId', 'keyword') &&
    hasMapping(properties, 'aggregateVersion', 'long') &&
    hasMapping(properties, 'indexGeneration', 'integer') &&
    hasMapping(properties, 'searchable', 'boolean') &&
    hasMapping(properties, 'companyId', 'keyword') &&
    hasMapping(
      properties,
      'companyName',
      'text',
      'vietnamese_text',
      true,
    ) &&
    hasMapping(properties, 'title', 'text', 'vietnamese_text') &&
    hasMapping(properties, 'description', 'text', 'vietnamese_text') &&
    hasMapping(properties, 'salaryMin', 'double') &&
    hasMapping(properties, 'salaryMax', 'double') &&
    hasMapping(properties, 'isNegotiable', 'boolean') &&
    hasMapping(properties, 'currency', 'keyword') &&
    hasMapping(properties, 'location', 'text', 'vietnamese_text', true) &&
    hasMapping(properties, 'jobType', 'keyword') &&
    hasMapping(properties, 'experienceYears', 'integer') &&
    hasMapping(properties, 'skills', 'text', 'vietnamese_text', true) &&
    hasMapping(properties, 'deadline', 'date') &&
    hasMapping(properties, 'status', 'keyword') &&
    hasMapping(properties, 'publishedAt', 'date');
}

function hasMapping(
  properties: Record<string, IndexMappingField> | undefined,
  name: string,
  type: string,
  analyzer?: string,
  keyword = false,
): boolean {
  const field = properties?.[name];
  if (
    field?.type !== type ||
    field.index === false ||
    (type !== 'text' && field.doc_values === false) ||
    (analyzer !== undefined && field.analyzer !== analyzer)
  ) {
    return false;
  }
  if (!keyword) return true;
  const keywordField = field.fields?.keyword;
  return keywordField?.type === 'keyword' &&
    keywordField.index !== false &&
    keywordField.doc_values !== false;
}

function isCompatibleVietnameseAnalyzer(
  analysis: IndexAnalysisContract | undefined,
): boolean {
  const analyzer = analysis?.analyzer?.vietnamese_text;
  const charFilter = analyzer?.char_filter;
  return analyzer?.type === 'custom' &&
    analyzer.tokenizer === 'standard' &&
    (
      charFilter === undefined ||
      (Array.isArray(charFilter) && charFilter.length === 0)
    ) &&
    Array.isArray(analyzer.filter) &&
    analyzer.filter.length === 2 &&
    analyzer.filter[0] === 'lowercase' &&
    analyzer.filter[1] === 'asciifolding';
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

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('REDIS_COMMAND_TIMEOUT');
      error.name = 'REDIS_COMMAND_TIMEOUT';
      reject(error);
    }, timeoutMs);
    timer.unref();
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function redisRetryDelay(attempt: number): number {
  return Math.min(Math.max(attempt, 1) * 100, 1_000);
}

function failureCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'ELASTICSEARCH_INDEX_INCOMPATIBLE') {
      return error.name;
    }
    if (error.message === 'JOB_SOURCE_VERSION_BEHIND') {
      return error.message;
    }
    if (
      error.message.includes('Company Service') ||
      error.message.includes('public company')
    ) {
      return 'COMPANY_LOOKUP_FAILED';
    }
  }
  const statusCode = elasticStatusCode(error);
  if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
    return 'ELASTICSEARCH_UNAVAILABLE';
  }
  if (isIndexNotFound(error)) return 'ELASTICSEARCH_INDEX_NOT_FOUND';
  return 'INDEXING_FAILED';
}

function elasticStatusCode(error: unknown): number | undefined {
  return (error as { meta?: { statusCode?: number } }).meta?.statusCode;
}

function elasticErrorType(error: unknown): string | undefined {
  const body = (error as {
    meta?: { body?: { error?: string | { type?: string } } };
  }).meta?.body;
  return typeof body?.error === 'string' ? body.error : body?.error?.type;
}

function isIndexNotFound(error: unknown): boolean {
  return elasticStatusCode(error) === 404 &&
    elasticErrorType(error) === 'index_not_found_exception';
}

function isIndexAlreadyExists(error: unknown): boolean {
  return elasticStatusCode(error) === 400 &&
    elasticErrorType(error) === 'resource_already_exists_exception';
}
