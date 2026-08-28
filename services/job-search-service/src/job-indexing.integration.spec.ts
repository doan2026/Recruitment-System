import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import {
  Job,
  JobIndexSync,
  JobStatus,
  JobType,
  Prisma,
} from '@prisma/client';
import { Job as BullJob, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { CompanyClientService } from './company-client.service';
import { JobIndexingService } from './job-indexing.service';
import {
  JobSearchPaginationMode,
  JobSearchSort,
  JobSearchSource,
} from './job-search.dto';
import { JobSearchCursorService } from './job-search-cursor.service';
import { JobSearchService } from './job-search.service';
import { PrismaService } from './prisma.service';

const integrationDescribe =
  process.env.JOB_INTEGRATION_TEST === '1' ? describe : describe.skip;
const RUN_ID = String(process.pid) + '-' + String(Date.now());
const INDEX = 'job_index_it_' + RUN_ID.replace(/-/g, '_');
const QUEUE_NAME = 'job-indexing-it-' + RUN_ID;
const REDIS_URL =
  process.env.REDIS_URL ??
  'redis://:job_test_redis_password@redis-test:6379/15';
const ELASTICSEARCH_NODE =
  process.env.ELASTICSEARCH_NODE ?? 'http://elasticsearch-test:9200';
const SEARCH_CURSOR_KEY =
  'job-search-integration-cursor-key-at-least-32-bytes';

interface JobIndexTask {
  jobId: string;
  aggregateVersion: number;
  generation: number;
}

interface StoredJobDocument {
  jobId: string;
  aggregateVersion: number;
  indexGeneration?: number;
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
  jobType?: JobType;
  experienceYears?: number;
  skills?: string[];
  deadline?: string;
  publishedAt?: string | null;
}

interface StoredDocumentResponse {
  source: StoredJobDocument;
  version: number;
}

class CompanyHttpStub {
  private readonly server: Server;
  unavailable = false;
  failuresRemaining = 0;
  calls = 0;
  url = '';

  constructor() {
    this.server = createServer((request, response) => {
      this.calls += 1;
      if (this.unavailable || this.failuresRemaining > 0) {
        if (this.failuresRemaining > 0) this.failuresRemaining -= 1;
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          code: 'COMPANY_STUB_UNAVAILABLE',
          message: 'controlled integration failure',
        }));
        return;
      }

      const companyId = decodeURIComponent(
        (request.url ?? '/unknown').split('/').filter(Boolean).at(-1) ??
          'unknown',
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        data: {
          id: companyId,
          name: 'Công ty Ánh Dương',
        },
      }));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', onError);
        resolve();
      });
    });
    const address = this.server.address() as AddressInfo;
    this.url = 'http://127.0.0.1:' + String(address.port);
  }

  healthy(): void {
    this.unavailable = false;
    this.failuresRemaining = 0;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}

integrationDescribe('Job indexing with PostgreSQL, Redis and Elasticsearch', () => {
  jest.setTimeout(60_000);

  const companyStub = new CompanyHttpStub();
  let prisma: PrismaService;
  let indexing: JobIndexingService;
  let search: JobSearchService;
  let searchCursor: JobSearchCursorService;
  let elastic: Client;
  let externalQueue: Queue<JobIndexTask>;
  let config: ConfigService;

  beforeAll(async () => {
    await companyStub.start();
    prisma = new PrismaService();
    await prisma.onModuleInit();
    await prisma.jobIndexSync.deleteMany();
    await prisma.jobEventOutbox.deleteMany();
    await prisma.job.deleteMany();

    elastic = new Client({
      node: ELASTICSEARCH_NODE,
      requestTimeout: 3_000,
      maxRetries: 0,
    });
    if (await elastic.indices.exists({ index: INDEX })) {
      await elastic.indices.delete({ index: INDEX });
    }

    config = serviceConfig();
    const companies = new CompanyClientService(config);
    indexing = new JobIndexingService(prisma, companies, config);
    searchCursor = new JobSearchCursorService(config);
    search = new JobSearchService(prisma, config, indexing, searchCursor);
    externalQueue = new Queue<JobIndexTask>(QUEUE_NAME, {
      connection: redisConnection(REDIS_URL),
    });

    indexing.onModuleInit();
    await waitFor(
      () => elastic.indices.exists({ index: INDEX }),
      (exists) => exists,
      'Elasticsearch index was not initialized',
      20_000,
    );
    await waitFor(
      async () => indexing.isSearchReady(),
      (ready) => ready,
      'Elasticsearch baseline was not marked ready',
      20_000,
    );
  }, 40_000);

  afterAll(async () => {
    if (indexing) await indexing.onModuleDestroy();
    if (externalQueue) await externalQueue.close();
    if (search) {
      await (search as unknown as { elastic: Client }).elastic.close();
    }
    if (elastic) {
      if (await elastic.indices.exists({ index: INDEX })) {
        await elastic.indices.delete({ index: INDEX });
      }
      await elastic.close();
    }
    if (prisma) {
      await prisma.jobIndexSync.deleteMany();
      await prisma.jobEventOutbox.deleteMany();
      await prisma.job.deleteMany();
      await prisma.onModuleDestroy();
    }
    await companyStub.stop();
  }, 40_000);

  it('indexes a published Job and searches accentless Vietnamese text', async () => {
    const job = await createTrackedJob({
      title: 'Kỹ sư dữ liệu tiếng Việt',
      description: 'Xây dựng nền tảng tuyển dụng có khả năng mở rộng',
      location: 'Hà Nội',
      skills: ['Dữ liệu', 'NestJS'],
    });

    await indexing.flushPending();
    await waitForCompleted(job.id);
    await elastic.indices.refresh({ index: INDEX });

    const result = await search.search({
      q: 'ky su du lieu',
      page: 1,
      limit: 20,
      sort: JobSearchSort.RELEVANCE,
      pagination: JobSearchPaginationMode.OFFSET,
    });

    expect(result.source).toBe(JobSearchSource.ELASTICSEARCH);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: job.id,
        title: job.title,
        companyName: 'Công ty Ánh Dương',
      }),
    ]));

    const analyzed = await elastic.indices.analyze({
      index: INDEX,
      analyzer: 'vietnamese_text',
      text: 'Kỹ sư dữ liệu Đà Nẵng',
    });
    const analyzedNfd = await elastic.indices.analyze({
      index: INDEX,
      analyzer: 'vietnamese_text',
      text: 'Kỹ sư dữ liệu Đà Nẵng'.normalize('NFD'),
    });
    const analyzedAccentless = await elastic.indices.analyze({
      index: INDEX,
      analyzer: 'vietnamese_text',
      text: 'ky su du lieu da nang',
    });
    const expectedTokens = ['ky', 'su', 'du', 'lieu', 'da', 'nang'];
    expect(analyzed.tokens?.map((token) => token.token)).toEqual(
      expectedTokens,
    );
    expect(analyzedNfd.tokens?.map((token) => token.token)).toEqual(
      expectedTokens,
    );
    expect(analyzedAccentless.tokens?.map((token) => token.token)).toEqual(
      expectedTokens,
    );
    await expectStrictMapping();
  });

  it('traverses tied results with PIT search_after and fails a closed PIT stale',
  async () => {
    const count = 205;
    const jobIds = Array.from({ length: count }, () => randomUUID());
    const operations = jobIds.flatMap((jobId) => [
      { index: { _index: INDEX, _id: jobId } },
      {
        jobId,
        aggregateVersion: 1,
        indexGeneration: 1,
        searchable: true,
        companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        companyName: 'Công ty Phân Trang',
        title: 'Kiểm chứng phân trang sâu',
        description: 'Tất cả kết quả cố ý trùng thời gian công bố',
        salaryMin: 20_000_000,
        salaryMax: 30_000_000,
        isNegotiable: false,
        currency: 'VND',
        location: 'Hà Nội',
        jobType: JobType.FULL_TIME,
        experienceYears: 2,
        skills: ['Dữ liệu'],
        deadline: '2099-12-31',
        status: JobStatus.PUBLISHED,
        publishedAt: '2026-08-29T00:00:00.000Z',
      },
    ]);
    const bulk = await elastic.bulk({ refresh: true, operations });
    expect(bulk.errors).toBe(false);

    const baseQuery = {
      q: 'kiem chung phan trang sau',
      companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      page: 1,
      limit: 50,
      sort: JobSearchSort.RELEVANCE,
      pagination: JobSearchPaginationMode.CURSOR,
    };
    const seen = new Set<string>();
    let cursor: string | undefined;
    let expectedPage = 1;
    do {
      const result = await search.search({
        ...baseQuery,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.source).toBe(JobSearchSource.ELASTICSEARCH);
      expect(result.total).toBe(count);
      expect(result.page).toBe(expectedPage);
      for (const item of result.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = result.nextCursor ?? undefined;
      expectedPage += 1;
    } while (cursor);
    expect(seen).toEqual(new Set(jobIds));

    const first = await search.search(baseQuery);
    expect(first.nextCursor).toEqual(expect.any(String));
    const state = searchCursor.decode(first.nextCursor ?? undefined, baseQuery);
    expect(state).not.toBeNull();
    await elastic.closePointInTime({ id: state!.pitId });
    await expect(search.search({
      ...baseQuery,
      cursor: first.nextCursor ?? undefined,
    })).rejects.toMatchObject({
      code: 'JOB_SEARCH_CURSOR_STALE',
      status: 409,
    });
  });

  it('keeps the newer tombstone when an older BullMQ task arrives late',
  async () => {
    const published = await createTrackedJob({
      title: 'Backend phiên bản cũ',
    });
    const versionOne = await prisma.jobIndexSync.findUniqueOrThrow({
      where: { jobId: published.id },
    });
    await indexing.flushPending();
    await waitForCompleted(published.id, versionOne.generation);

    const closed = await updateTrackedJob(
      published.id,
      JobStatus.CLOSED,
      'Backend đã đóng',
    );
    const versionTwo = await prisma.jobIndexSync.findUniqueOrThrow({
      where: { jobId: published.id },
    });
    await indexing.flushPending();
    await waitForCompleted(closed.id, versionTwo.generation);

    const staleTask = await externalQueue.add(
      'sync-job',
      {
        jobId: published.id,
        aggregateVersion: versionOne.aggregateVersion,
        generation: versionOne.generation,
      },
      {
        jobId:
          'stale-' + published.id.replace(/-/g, '') + '-' + String(Date.now()),
        attempts: 1,
        removeOnComplete: false,
      },
    );
    await waitForQueueCompletion(staleTask);
    await elastic.indices.refresh({ index: INDEX });

    const stored = await getStoredDocument(published.id);
    expect(stored.version).toBe(2);
    expect(stored.source).toMatchObject({
      jobId: published.id,
      aggregateVersion: 2,
      searchable: false,
      status: JobStatus.CLOSED,
    });
    expect(stored.source.title).toBeUndefined();

    const result = await search.search({
      q: 'Backend phiên bản cũ',
      page: 1,
      limit: 20,
      sort: JobSearchSort.RELEVANCE,
      pagination: JobSearchPaginationMode.OFFSET,
    });
    expect(result.source).toBe(JobSearchSource.ELASTICSEARCH);
    expect(result.items.find((item) => item.id === published.id)).toBeUndefined();
  });

  it('keeps the newer projection generation at the same aggregate version',
  async () => {
    const jobId = randomUUID();
    const writer = indexing as unknown as {
      writeVersionedDocument(
        task: JobIndexTask,
        document: StoredJobDocument,
      ): Promise<void>;
    };
    const newerTask: JobIndexTask = {
      jobId,
      aggregateVersion: 7,
      generation: 2,
    };
    const newerDocument: StoredJobDocument = {
      jobId,
      aggregateVersion: 7,
      indexGeneration: 2,
      searchable: true,
      status: JobStatus.PUBLISHED,
      title: 'Projection generation 2',
    };

    await writer.writeVersionedDocument(newerTask, newerDocument);
    await writer.writeVersionedDocument(
      { ...newerTask, generation: 1 },
      {
        ...newerDocument,
        indexGeneration: 1,
        title: 'Stale projection generation 1',
      },
    );
    await elastic.indices.refresh({ index: INDEX });

    expect((await getStoredDocument(jobId)).source).toMatchObject({
      aggregateVersion: 7,
      indexGeneration: 2,
      title: 'Projection generation 2',
    });
  });

  it('reindexes every Job idempotently and repairs stale closed documents',
  async () => {
    const searchable = await createUntrackedJob({
      title: 'Chuyên viên reindex',
    });
    const closed = await createUntrackedJob({
      title: 'Tin đã đóng nhưng còn stale',
      status: JobStatus.CLOSED,
      publishedAt: null,
    });
    await elastic.index({
      index: INDEX,
      id: closed.id,
      document: publishedDocument(closed, JobStatus.PUBLISHED),
      version: closed.aggregateVersion,
      version_type: 'external_gte',
      refresh: 'wait_for',
    });

    const totalJobs = await prisma.job.count();
    await expect(indexing.reindexAll()).resolves.toBe(totalJobs);
    await expect(indexing.reindexAll()).resolves.toBe(totalJobs);
    const searchableSync = await prisma.jobIndexSync.findUniqueOrThrow({
      where: { jobId: searchable.id },
    });
    const closedSync = await prisma.jobIndexSync.findUniqueOrThrow({
      where: { jobId: closed.id },
    });
    await indexing.flushPending();
    await waitForCompleted(searchable.id, searchableSync.generation);
    await waitForCompleted(closed.id, closedSync.generation);
    await elastic.indices.refresh({ index: INDEX });

    const indexed = await getStoredDocument(searchable.id);
    const tombstone = await getStoredDocument(closed.id);
    expect(indexed.source).toMatchObject({
      aggregateVersion: searchable.aggregateVersion,
      searchable: true,
      status: JobStatus.PUBLISHED,
    });
    expect(tombstone.source).toEqual(expect.objectContaining({
      jobId: closed.id,
      aggregateVersion: closed.aggregateVersion,
      searchable: false,
      status: JobStatus.CLOSED,
    }));
    expect(tombstone.source.title).toBeUndefined();

    const before = indexed;
    await expect(indexing.reindexAll()).resolves.toBe(totalJobs);
    const replayedSync = await prisma.jobIndexSync.findUniqueOrThrow({
      where: { jobId: searchable.id },
    });
    await indexing.flushPending();
    await waitForCompleted(searchable.id, replayedSync.generation);
    await elastic.indices.refresh({ index: INDEX });
    const after = await getStoredDocument(searchable.id);

    expect(after.version).toBeGreaterThan(before.version);
    expect(after.source).toEqual({
      ...before.source,
      indexGeneration: replayedSync.generation,
    });
  });

  it('does not let a stale reindex snapshot downgrade desired state',
  async () => {
    const job = await createTrackedJob({
      title: 'Reindex snapshot v1',
    });
    const initialSync = await prisma.jobIndexSync.findUniqueOrThrow({
      where: { jobId: job.id },
    });
    let firstPage = true;
    let newerSync!: JobIndexSync;
    const snapshotPrisma = {
      job: {
        findMany: jest.fn(async () => {
          if (!firstPage) return [];
          firstPage = false;
          const staleSnapshot = await prisma.job.findUniqueOrThrow({
            where: { id: job.id },
          });
          await updateTrackedJob(
            job.id,
            JobStatus.PUBLISHED,
            'Reindex snapshot v2',
          );
          newerSync = await prisma.jobIndexSync.findUniqueOrThrow({
            where: { jobId: job.id },
          });
          return [{
            id: staleSnapshot.id,
            aggregateVersion: staleSnapshot.aggregateVersion,
          }];
        }),
      },
      $executeRaw: prisma.$executeRaw.bind(prisma),
    } as unknown as PrismaService;
    const snapshotConfig = serviceConfig({
      JOB_INDEX_QUEUE_NAME: QUEUE_NAME + '-snapshot',
    });
    const snapshotService = new JobIndexingService(
      snapshotPrisma,
      new CompanyClientService(snapshotConfig),
      snapshotConfig,
    );
    const wake = jest.spyOn(snapshotService, 'wake').mockImplementation();

    try {
      await expect(snapshotService.reindexAll()).resolves.toBe(1);
      const durable = await prisma.jobIndexSync.findUniqueOrThrow({
        where: { jobId: job.id },
      });

      expect(newerSync.aggregateVersion).toBe(
        initialSync.aggregateVersion + 1,
      );
      expect(newerSync.generation).toBe(initialSync.generation + 1);
      expect(durable.aggregateVersion).toBe(newerSync.aggregateVersion);
      expect(durable.generation).toBe(newerSync.generation);
      expect(wake).toHaveBeenCalledTimes(1);
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });

  it('retries a transient Elasticsearch write failure', async () => {
    await setIndexWriteBlock(true);
    const job = await createTrackedJob({
      title: 'Elasticsearch retry',
    });

    try {
      await indexing.flushPending();
      await waitForSync(
        job.id,
        (sync) => sync.processingAttempts >= 1,
        'BullMQ did not record the first Elasticsearch failure',
        10_000,
        5,
      );
    } finally {
      await setIndexWriteBlock(false);
    }

    const completed = await waitForCompleted(job.id);
    expect(completed.processingAttempts).toBeGreaterThanOrEqual(2);
    await elastic.indices.refresh({ index: INDEX });
    await expect(getStoredDocument(job.id)).resolves.toEqual(
      expect.objectContaining({
        source: expect.objectContaining({
          searchable: true,
          title: 'Elasticsearch retry',
        }),
      }),
    );
  });

  it('persists terminal failures and replays the durable dead letter', async () => {
    companyStub.unavailable = true;
    const job = await createTrackedJob({
      title: 'Company lookup dead letter',
    });
    await indexing.flushPending();

    const failed = await waitForSync(
      job.id,
      (sync) => sync.failedAt !== null,
      'Index sync did not reach its durable failed state',
      15_000,
    );
    expect(failed.processingAttempts).toBe(3);
    expect(failed.lastError).toBe('COMPANY_LOOKUP_FAILED');

    const failures = await indexing.listFailures(50);
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobId: job.id,
        aggregateVersion: job.aggregateVersion,
        generation: failed.generation,
        processingAttempts: 3,
        lastError: 'COMPANY_LOOKUP_FAILED',
      }),
    ]));

    companyStub.healthy();
    await expect(indexing.retryFailures()).resolves.toBe(1);
    const replay = await prisma.jobIndexSync.findUniqueOrThrow({
      where: { jobId: job.id },
    });
    expect(replay.generation).toBe(failed.generation + 1);
    expect(replay.failedAt).toBeNull();

    await indexing.flushPending();
    await waitForCompleted(job.id, replay.generation);
    expect(
      (await indexing.listFailures(50)).some(
        (failure) => failure.jobId === job.id,
      ),
    ).toBe(false);
    await elastic.indices.refresh({ index: INDEX });
    expect((await getStoredDocument(job.id)).source.searchable).toBe(true);
  });

  it('uses job_index_v4 without mutating an existing job_index_v3',
  async () => {
    const legacyIndex = 'job_index_v3';
    const upgradedIndex = 'job_index_v4';
    const legacyDocumentId = 'legacy-' + randomUUID();
    await deleteIndexIfExists(legacyIndex);
    await deleteIndexIfExists(upgradedIndex);
    await elastic.indices.create({
      index: legacyIndex,
      mappings: {
        dynamic: 'strict',
        properties: {
          jobId: { type: 'keyword' },
          title: { type: 'text' },
        },
      },
    });
    await elastic.index({
      index: legacyIndex,
      id: legacyDocumentId,
      document: {
        jobId: legacyDocumentId,
        title: 'Legacy internal version document',
      },
      refresh: 'wait_for',
    });

    const upgradeConfig = serviceConfig({
      ELASTICSEARCH_INDEX: undefined,
      JOB_INDEX_QUEUE_NAME: QUEUE_NAME + '-upgrade',
    });
    const upgradeService = new JobIndexingService(
      prisma,
      new CompanyClientService(upgradeConfig),
      upgradeConfig,
    );
    jest.spyOn(upgradeService, 'wake').mockImplementation();

    try {
      upgradeService.onModuleInit();
      await waitFor(
        () => elastic.indices.exists({ index: upgradedIndex }),
        (exists) => exists,
        'Versioned default Elasticsearch index was not created',
        20_000,
      );

      expect(await elastic.indices.exists({ index: legacyIndex })).toBe(true);
      const legacyDocument = await elastic.get<{
        jobId: string;
        title: string;
      }>({
        index: legacyIndex,
        id: legacyDocumentId,
      });
      expect(legacyDocument._version).toBe(1);
      expect(legacyDocument._source).toEqual({
        jobId: legacyDocumentId,
        title: 'Legacy internal version document',
      });

      const legacyMapping = await elastic.indices.getMapping({
        index: legacyIndex,
      });
      const configuredLegacy = legacyMapping[legacyIndex]?.mappings as {
        dynamic?: string | boolean;
        properties?: Record<string, unknown>;
      };
      expect(configuredLegacy.dynamic).toBe('strict');
      expect(configuredLegacy.properties).not.toHaveProperty(
        'aggregateVersion',
      );
      expect(configuredLegacy.properties).not.toHaveProperty('searchable');
      await expectStrictMapping(upgradedIndex);
    } finally {
      await upgradeService.onModuleDestroy();
      await deleteIndexIfExists(legacyIndex);
      await deleteIndexIfExists(upgradedIndex);
    }
  });

  it('recreates strict mappings when auto-create is disabled and index is lost',
  async () => {
    await elastic.indices.delete({ index: INDEX });
    expect(await elastic.indices.exists({ index: INDEX })).toBe(false);

    const job = await createTrackedJob({
      title: 'Khôi phục chỉ mục',
    });
    await indexing.flushPending();
    await waitForCompleted(job.id);

    expect(await elastic.indices.exists({ index: INDEX })).toBe(true);
    await expectStrictMapping();
    await elastic.indices.refresh({ index: INDEX });
    expect((await getStoredDocument(job.id)).source).toMatchObject({
      jobId: job.id,
      aggregateVersion: job.aggregateVersion,
      searchable: true,
      title: 'Khôi phục chỉ mục',
    });
  });

  it('recovers the same durable intent after a cold Redis outage',
  async () => {
    await waitFor(
      async () => indexing.isSearchReady(),
      (ready) => ready,
      'Elasticsearch baseline was not ready before the Redis outage',
      20_000,
    );
    await indexing.onModuleDestroy();
    const outageConfig = serviceConfig({
      REDIS_URL:
        'redis://:job_test_redis_password@redis-test:6390/14',
      JOB_INDEX_QUEUE_NAME: QUEUE_NAME + '-redis-outage',
      JOB_INDEX_REDIS_COMMAND_TIMEOUT_MS: '300',
    });
    const outageService = new JobIndexingService(
      prisma,
      new CompanyClientService(outageConfig),
      outageConfig,
    );
    outageService.onModuleInit();
    let outageStopped = false;
    let job!: Job;

    try {
      job = await prisma.$transaction(async (transaction) => {
        const created = await transaction.job.create({
          data: jobData({ title: 'Durable during Redis outage' }),
        });
        await outageService.append(transaction, created);
        return created;
      });

      const flushStartedAt = Date.now();
      await expect(outageService.flushPending()).resolves.toBe(0);
      expect(Date.now() - flushStartedAt).toBeLessThan(3_000);

      const pending = await waitForSync(
        job.id,
        (sync) =>
          sync.completedAt === null &&
          sync.failedAt === null &&
          sync.lastError === 'REDIS_ENQUEUE_FAILED',
        'Redis outage did not preserve a pending durable intent',
        10_000,
      );
      expect(pending).toMatchObject({
        jobId: job.id,
        aggregateVersion: job.aggregateVersion,
        generation: 1,
        lastError: 'REDIS_ENQUEUE_FAILED',
      });
      expect(pending.dispatchAttempts).toBeGreaterThanOrEqual(1);

      const destroyStartedAt = Date.now();
      await outageService.onModuleDestroy();
      outageStopped = true;
      expect(Date.now() - destroyStartedAt).toBeLessThan(3_000);
    } finally {
      if (!outageStopped) {
        await outageService.onModuleDestroy().catch(() => undefined);
      }
      const recoveryConfig = serviceConfig({
        JOB_INDEX_QUEUE_NAME: QUEUE_NAME + '-redis-outage',
      });
      indexing = new JobIndexingService(
        prisma,
        new CompanyClientService(recoveryConfig),
        recoveryConfig,
      );
      indexing.onModuleInit();
    }

    const recovered = await waitFor(
      async () => {
        await indexing.flushPending();
        return prisma.jobIndexSync.findUniqueOrThrow({
          where: { jobId: job.id },
        });
      },
      (sync) => sync.completedAt !== null && sync.failedAt === null,
      'Durable intent did not complete after Redis recovered',
      20_000,
      50,
    );
    expect(recovered).toMatchObject({
      jobId: job.id,
      aggregateVersion: job.aggregateVersion,
      generation: 1,
      lastError: null,
    });
    expect(recovered.dispatchAttempts).toBeGreaterThanOrEqual(2);
    await elastic.indices.refresh({ index: INDEX });
    expect((await getStoredDocument(job.id)).source).toMatchObject({
      jobId: job.id,
      aggregateVersion: job.aggregateVersion,
      searchable: true,
      title: 'Durable during Redis outage',
    });
  });

  it('resumes a missing baseline marker after restart and gates search',
  async () => {
    await indexing.onModuleDestroy();
    await (search as unknown as { elastic: Client }).elastic.close();
    await deleteIndexIfExists(INDEX);

    const crashConfig = serviceConfig({
      JOB_INDEX_QUEUE_NAME: QUEUE_NAME + '-bootstrap-crash',
    });
    const crashingBootstrap = new JobIndexingService(
      prisma,
      new CompanyClientService(crashConfig),
      crashConfig,
    );
    Object.assign(crashingBootstrap, {
      prepareBaseline: jest.fn().mockRejectedValue(
        new Error('SIMULATED_BOOTSTRAP_CRASH'),
      ),
    });
    try {
      await expect(
        (crashingBootstrap as unknown as {
          createIndexIfMissing(): Promise<void>;
        }).createIndexIfMissing(),
      ).rejects.toThrow('SIMULATED_BOOTSTRAP_CRASH');
      expect(await elastic.indices.exists({ index: INDEX })).toBe(true);
      const incomplete = await elastic.indices.getMapping({ index: INDEX });
      const incompleteMeta = incomplete[INDEX]?.mappings._meta as
        | Record<string, unknown>
        | undefined;
      expect(incompleteMeta?.baselineVersion).toBeUndefined();
      expect(incompleteMeta?.baselineIndexUuid).toBeUndefined();
      expect(crashingBootstrap.isSearchReady()).toBe(false);
    } finally {
      await crashingBootstrap.onModuleDestroy();
    }

    indexing = new JobIndexingService(
      prisma,
      new CompanyClientService(config),
      config,
    );
    searchCursor = new JobSearchCursorService(config);
    search = new JobSearchService(prisma, config, indexing, searchCursor);
    indexing.onModuleInit();

    expect(indexing.isSearchReady()).toBe(false);
    const fallback = await search.search({
      page: 1,
      limit: 20,
      sort: JobSearchSort.NEWEST,
      pagination: JobSearchPaginationMode.OFFSET,
    });
    expect(fallback.source).toBe(JobSearchSource.POSTGRESQL);

    await waitFor(
      async () => indexing.isSearchReady(),
      (ready) => ready,
      'Restarted service did not finish the existing-index baseline',
      30_000,
      50,
    );
    const completed = await elastic.indices.getMapping({ index: INDEX });
    const completedMeta = completed[INDEX]?.mappings._meta as
      | Record<string, unknown>
      | undefined;
    const completedSettings = await elastic.indices.getSettings({
      index: INDEX,
    });
    const completedIndexUuid = (
      completedSettings[INDEX]?.settings as
        | { index?: { uuid?: string } }
        | undefined
    )?.index?.uuid;
    expect(completedMeta?.baselineVersion).toBe(4);
    expect(completedIndexUuid).toEqual(expect.any(String));
    expect(completedMeta?.baselineIndexUuid).toBe(completedIndexUuid);

    const indexed = await search.search({
      page: 1,
      limit: 20,
      sort: JobSearchSort.NEWEST,
      pagination: JobSearchPaginationMode.OFFSET,
    });
    expect(indexed.source).toBe(JobSearchSource.ELASTICSEARCH);
  });

  function serviceConfig(
    overrides: Record<string, string | undefined> = {},
  ): ConfigService {
    const values: Record<string, string | undefined> = {
      COMPANY_SERVICE_URL: companyStub.url,
      REDIS_URL,
      ELASTICSEARCH_NODE,
      ELASTICSEARCH_INDEX: INDEX,
      ELASTICSEARCH_REQUEST_TIMEOUT_MS: '1000',
      JOB_SEARCH_CURSOR_HMAC_KEY: SEARCH_CURSOR_KEY,
      JOB_INDEX_QUEUE_NAME: QUEUE_NAME,
      JOB_INDEX_ATTEMPTS: '3',
      JOB_INDEX_BACKOFF_MS: '50',
      JOB_INDEX_CONCURRENCY: '1',
      JOB_INDEX_POLL_INTERVAL_MS: '50',
      JOB_INDEX_RECONCILE_MS: '200',
      JOB_INDEX_LEASE_MS: '500',
      JOB_INDEX_BATCH_SIZE: '20',
      JOB_INDEX_REDIS_COMMAND_TIMEOUT_MS: '500',
      ...overrides,
    };
    return {
      get<T>(key: string): T | undefined {
        return values[key] as T | undefined;
      },
    } as unknown as ConfigService;
  }

  async function createTrackedJob(
    overrides: Partial<Prisma.JobUncheckedCreateInput> = {},
  ): Promise<Job> {
    return prisma.$transaction(async (transaction) => {
      const job = await transaction.job.create({
        data: jobData(overrides),
      });
      await indexing.append(transaction, job);
      return job;
    });
  }

  async function createUntrackedJob(
    overrides: Partial<Prisma.JobUncheckedCreateInput> = {},
  ): Promise<Job> {
    return prisma.job.create({ data: jobData(overrides) });
  }

  async function updateTrackedJob(
    jobId: string,
    status: JobStatus,
    title: string,
  ): Promise<Job> {
    return prisma.$transaction(async (transaction) => {
      const job = await transaction.job.update({
        where: { id: jobId },
        data: {
          status,
          title,
          aggregateVersion: { increment: 1 },
          ...(status === JobStatus.PUBLISHED
            ? { publishedAt: new Date() }
            : {}),
        },
      });
      await indexing.append(transaction, job);
      return job;
    });
  }

  function jobData(
    overrides: Partial<Prisma.JobUncheckedCreateInput>,
  ): Prisma.JobUncheckedCreateInput {
    const status = overrides.status ?? JobStatus.PUBLISHED;
    return {
      id: randomUUID(),
      companyId: randomUUID(),
      createdBy: randomUUID(),
      title: 'Kỹ sư phần mềm',
      description: 'Xây dựng hệ thống tuyển dụng',
      requirements: 'Kinh nghiệm TypeScript và PostgreSQL',
      benefits: 'Làm việc linh hoạt',
      salaryMin: 20_000_000,
      salaryMax: 35_000_000,
      isNegotiable: false,
      currency: 'VND',
      location: 'Hà Nội',
      jobType: JobType.FULL_TIME,
      experienceYears: 2,
      quantity: 2,
      skills: ['TypeScript', 'PostgreSQL'],
      deadline: new Date('2099-12-31T00:00:00.000Z'),
      status,
      aggregateVersion: 1,
      publishedAt:
        status === JobStatus.PUBLISHED ? new Date() : null,
      ...overrides,
    };
  }

  async function waitForCompleted(
    jobId: string,
    generation?: number,
  ): Promise<JobIndexSync> {
    return waitForSync(
      jobId,
      (sync) =>
        sync.completedAt !== null &&
        sync.failedAt === null &&
        (generation === undefined || sync.generation === generation),
      'Index sync did not complete for Job ' + jobId,
      20_000,
    );
  }

  async function waitForSync(
    jobId: string,
    predicate: (sync: JobIndexSync) => boolean,
    message: string,
    timeoutMs: number,
    intervalMs = 25,
  ): Promise<JobIndexSync> {
    return waitFor(
      () => prisma.jobIndexSync.findUniqueOrThrow({
        where: { jobId },
      }),
      predicate,
      message,
      timeoutMs,
      intervalMs,
    );
  }

  async function waitForQueueCompletion(
    queueJob: BullJob<JobIndexTask>,
  ): Promise<void> {
    const state = await waitFor(
      () => queueJob.getState(),
      (current) => current === 'completed' || current === 'failed',
      'Stale BullMQ task did not finish',
      10_000,
    );
    expect(state).toBe('completed');
  }

  async function getStoredDocument(
    jobId: string,
  ): Promise<StoredDocumentResponse> {
    const result = await elastic.get<StoredJobDocument>({
      index: INDEX,
      id: jobId,
    });
    if (!result._source || result._version === undefined) {
      throw new Error('Elasticsearch document has no source for Job ' + jobId);
    }
    return {
      source: result._source,
      version: result._version,
    };
  }

  function publishedDocument(
    job: Job,
    status = job.status,
  ): StoredJobDocument {
    return {
      jobId: job.id,
      aggregateVersion: job.aggregateVersion,
      searchable: true,
      status,
      companyId: job.companyId,
      companyName: 'Stale Company',
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
  }

  async function deleteIndexIfExists(indexName: string): Promise<void> {
    if (await elastic.indices.exists({ index: indexName })) {
      await elastic.indices.delete({ index: indexName });
    }
  }

  async function setIndexWriteBlock(blocked: boolean): Promise<void> {
    await elastic.indices.putSettings({
      index: INDEX,
      settings: {
        'index.blocks.write': blocked,
      },
    });
  }

  async function expectStrictMapping(
    indexName = INDEX,
  ): Promise<void> {
    const mapping = await elastic.indices.getMapping({ index: indexName });
    const configured = mapping[indexName]?.mappings as {
      dynamic?: string | boolean;
      _meta?: { projectionVersion?: number };
      properties?: Record<string, unknown>;
    };
    expect(configured.dynamic).toBe('strict');
    expect(configured._meta?.projectionVersion).toBe(4);
    expect(configured.properties).toEqual(expect.objectContaining({
      aggregateVersion: expect.objectContaining({ type: 'long' }),
      indexGeneration: expect.objectContaining({ type: 'integer' }),
      searchable: expect.objectContaining({ type: 'boolean' }),
      title: expect.objectContaining({ analyzer: 'vietnamese_text' }),
    }));
    const settings = await elastic.indices.getSettings({ index: indexName });
    const analysis = (
      settings[indexName]?.settings as unknown as {
        index?: {
          analysis?: {
            analyzer?: Record<string, unknown>;
            char_filter?: Record<string, unknown>;
          };
        };
      }
    )?.index?.analysis;
    expect(analysis).toEqual({
      analyzer: {
        vietnamese_text: {
          type: 'custom',
          tokenizer: 'standard',
          char_filter: ['vietnamese_combining_marks'],
          filter: ['lowercase', 'asciifolding'],
        },
      },
      char_filter: {
        vietnamese_combining_marks: {
          type: 'pattern_replace',
          pattern: '\\p{M}',
          replacement: '',
        },
      },
    });
  }
});

function redisConnection(redisUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
} {
  const parsed = new URL(redisUrl);
  const database = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(database ? { db: Number(database) } : {}),
  };
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  message: string,
  timeoutMs: number,
  intervalMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await delay(intervalMs);
  }
  throw new Error(
    message +
      (lastValue === undefined
        ? ''
        : '; last value: ' + JSON.stringify(lastValue)),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
