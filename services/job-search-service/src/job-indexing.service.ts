import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { Job, JobStatus } from '@prisma/client';
import { Job as QueueJob, Queue, Worker } from 'bullmq';
import { randomUUID } from 'crypto';
import { Kafka, Producer } from 'kafkajs';
import { CompanyClientService } from './company-client.service';
import { PrismaService } from './prisma.service';

export type JobEventAction = 'CREATED' | 'UPDATED' | 'CLOSED' | 'EXPIRED';

interface JobIndexTask {
  eventId: string;
  action: JobEventAction;
  jobId: string;
  occurredAt: string;
  event: {
    companyId: string;
    title: string;
    description: string;
    skills: string[];
    location: string;
    status: JobStatus;
  };
}

const QUEUE_NAME = 'job-search-indexing';

@Injectable()
export class JobIndexingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobIndexingService.name);
  private readonly elastic: Client;
  private readonly index: string;
  private readonly topic: string;
  private readonly connection: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    tls?: Record<string, never>;
  };
  private readonly queue: Queue<JobIndexTask>;
  private readonly producer: Producer;
  private worker?: Worker<JobIndexTask>;
  private producerConnection?: Promise<void>;
  private indexReady?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyClientService,
    config: ConfigService,
  ) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) throw new Error('REDIS_URL is required');
    this.connection = this.redisConnection(redisUrl);
    this.index = config.get<string>('ELASTICSEARCH_INDEX') ?? 'job_index';
    this.topic = config.get<string>('KAFKA_JOB_TOPIC') ?? 'job-events';
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
    this.queue = new Queue<JobIndexTask>(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    this.queue.on('error', (error) =>
      this.logger.error(`BullMQ queue error: ${error.message}`),
    );

    const brokers = (config.get<string>('KAFKA_BROKERS') ?? 'kafka:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    this.producer = new Kafka({
      clientId: 'job-search-service',
      brokers,
    }).producer({
      allowAutoTopicCreation: false,
      idempotent: true,
      maxInFlightRequests: 1,
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<JobIndexTask>(
      QUEUE_NAME,
      (job) => this.process(job),
      { connection: this.connection, concurrency: 5 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(
        `Index task ${job?.id ?? 'unknown'} failed: ${error.message}`,
      ),
    );
    this.worker.on('error', (error) =>
      this.logger.error(`BullMQ worker error: ${error.message}`),
    );
    void this.ensureIndex().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Elasticsearch index initialization deferred: ${message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    if (this.producerConnection) {
      await this.producer.disconnect().catch(() => undefined);
    }
    await this.elastic.close();
  }

  async schedule(job: Job, action: JobEventAction): Promise<void> {
    try {
      await this.addTask(job, action);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Job ${job.id} committed but indexing could not be queued: ${message}`,
      );
    }
  }

  async reindexAll(): Promise<number> {
    let cursor: string | undefined;
    let queued = 0;
    do {
      const jobs = await this.prisma.job.findMany({
        where: { status: JobStatus.PUBLISHED },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!jobs.length) break;
      await this.queue.addBulk(
        jobs.map((job) => ({
          name: 'sync-job',
          data: this.task(job, 'UPDATED'),
        })),
      );
      queued += jobs.length;
      cursor = jobs.at(-1)?.id;
    } while (cursor);
    return queued;
  }

  private async addTask(
    job: Job,
    action: JobEventAction,
  ): Promise<void> {
    await this.queue.add('sync-job', this.task(job, action));
  }

  private task(job: Job, action: JobEventAction): JobIndexTask {
    return {
      eventId: randomUUID(),
      action,
      jobId: job.id,
      occurredAt: new Date().toISOString(),
      event: {
        companyId: job.companyId,
        title: job.title,
        description: job.description,
        skills: job.skills,
        location: job.location,
        status: job.status,
      },
    };
  }

  private async process(queueJob: QueueJob<JobIndexTask>): Promise<void> {
    const task = queueJob.data;
    const job = await this.prisma.job.findUnique({
      where: { id: task.jobId },
    });
    if (!job) {
      await this.deleteFromIndex(task.jobId);
      await this.publishEvent(task);
      return;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const searchable =
      job.status === JobStatus.PUBLISHED &&
      job.deadline.getTime() >= today.getTime();
    if (searchable) {
      await this.ensureIndex();
      const companyName = await this.companies.getPublicCompanyName(
        job.companyId,
      );
      await this.elastic.index({
        index: this.index,
        id: job.id,
        document: {
          jobId: job.id,
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
          status: job.status,
          publishedAt: job.publishedAt?.toISOString() ?? null,
        },
      });
    } else {
      await this.deleteFromIndex(job.id);
    }

    await this.publishEvent(task);
  }

  private async deleteFromIndex(jobId: string): Promise<void> {
    try {
      await this.elastic.delete({ index: this.index, id: jobId });
    } catch (error) {
      const statusCode = (
        error as { meta?: { statusCode?: number } }
      ).meta?.statusCode;
      if (statusCode !== HttpStatus.NOT_FOUND) throw error;
    }
  }

  private async publishEvent(task: JobIndexTask): Promise<void> {
    await this.ensureProducer();
    await this.producer.send({
      topic: this.topic,
      messages: [{
        key: task.jobId,
        value: JSON.stringify({
          event_id: task.eventId,
          action: task.action,
          job_id: task.jobId,
          company_id: task.event.companyId,
          title: task.event.title,
          description: task.event.description,
          skills: task.event.skills,
          location: task.event.location,
          status: task.event.status,
          occurred_at: task.occurredAt,
        }),
      }],
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
    if (await this.elastic.indices.exists({ index: this.index })) return;
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
        properties: {
          jobId: { type: 'keyword' },
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
  }

  private redisConnection(redisUrl: string): {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    tls?: Record<string, never>;
  } {
    let parsed: URL;
    try {
      parsed = new URL(redisUrl);
    } catch {
      throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
    }
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
      throw new Error('REDIS_URL must use redis:// or rediss://');
    }
    const dbText = parsed.pathname.replace(/^\//, '');
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      ...(parsed.username
        ? { username: decodeURIComponent(parsed.username) }
        : {}),
      ...(parsed.password
        ? { password: decodeURIComponent(parsed.password) }
        : {}),
      ...(dbText ? { db: Number(dbText) } : {}),
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }
}
