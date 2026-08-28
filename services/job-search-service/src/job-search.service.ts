import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, estypes } from '@elastic/elasticsearch';
import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import { ApiException } from './common';
import {
  JobSearchFacetsDto,
  JobSearchItemDto,
  JobSearchPaginationMode,
  JobSearchQueryDto,
  JobSearchResultDto,
  JobSearchSort,
  JobSearchSource,
} from './job-search.dto';
import { JobIndexingService } from './job-indexing.service';
import {
  JOB_SEARCH_CURSOR_TTL_MS,
  JobSearchCursor,
  JobSearchCursorService,
} from './job-search-cursor.service';
import { PrismaService } from './prisma.service';

const ELASTICSEARCH_MAX_RESULT_WINDOW = 10_000;
const DEFAULT_MAX_OPEN_PITS = 64;
const MAX_CONFIGURED_OPEN_PITS = 1_024;

interface JobSearchDocument {
  jobId: string;
  aggregateVersion: number;
  searchable: boolean;
  companyId: string;
  companyName?: string | null;
  title: string;
  description: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  isNegotiable: boolean;
  currency: string;
  location: string;
  jobType: JobType;
  experienceYears: number;
  skills: string[];
  deadline: string;
  status: JobStatus;
  publishedAt?: string | null;
}

interface AggregationBucket {
  key: string | number;
  doc_count: number;
}

interface BucketAggregation {
  buckets?: AggregationBucket[] | Record<string, AggregationBucket>;
}

@Injectable()
export class JobSearchService {
  private readonly logger = new Logger(JobSearchService.name);
  private readonly elastic: Client;
  private readonly index: string;
  private readonly maxOpenPits: number;
  private readonly ownedPits = new Map<string, number>();
  private pendingPitOpens = 0;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly indexing: JobIndexingService,
    private readonly cursor: JobSearchCursorService,
  ) {
    const configuredTimeout = Number(
      config.get<string>('ELASTICSEARCH_REQUEST_TIMEOUT_MS') ?? '2000',
    );
    this.elastic = new Client({
      node: config.get<string>('ELASTICSEARCH_NODE') ??
        'http://elasticsearch:9200',
      requestTimeout:
        Number.isFinite(configuredTimeout) && configuredTimeout > 0
          ? configuredTimeout
          : 2000,
      maxRetries: 0,
    });
    this.index = config.get<string>('ELASTICSEARCH_INDEX')?.trim() ||
      'job_index_v4';
    const configuredMaxOpenPits = Number(
      config.get<string>('JOB_SEARCH_MAX_OPEN_PITS') ??
        String(DEFAULT_MAX_OPEN_PITS),
    );
    if (
      !Number.isSafeInteger(configuredMaxOpenPits) ||
      configuredMaxOpenPits < 1 ||
      configuredMaxOpenPits > MAX_CONFIGURED_OPEN_PITS
    ) {
      throw new Error(
        `JOB_SEARCH_MAX_OPEN_PITS must be an integer from 1 to ${MAX_CONFIGURED_OPEN_PITS}`,
      );
    }
    this.maxOpenPits = configuredMaxOpenPits;
  }

  async search(query: JobSearchQueryDto): Promise<JobSearchResultDto> {
    this.validateSalaryRange(query);
    this.validatePagination(query);
    const cursorMode = query.pagination === JobSearchPaginationMode.CURSOR;
    const cursor = cursorMode
      ? this.cursor.decode(query.cursor, query)
      : null;
    const eligibilityDate = cursor?.eligibilityDate ?? utcDate();
    if (!this.indexing.isSearchReady()) {
      if (cursorMode) this.throwContinuationUnavailable();
      this.logger.warn(
        'Elasticsearch baseline is not ready; using PostgreSQL fallback',
      );
      return this.searchPostgres(query, eligibilityDate);
    }
    try {
      return await this.searchElasticsearch(query, cursor, eligibilityDate);
    } catch (error) {
      if (
        error instanceof ApiException &&
        error.code === 'JOB_SEARCH_CURSOR_CAPACITY'
      ) {
        throw error;
      }
      if (cursorMode) {
        this.logger.warn(
          `Elasticsearch cursor search failed (${elasticsearchErrorLabel(error)})`,
        );
        if (cursor !== null && isMissingPointInTime(error)) {
          this.throwCursorStale();
        }
        if (isElasticsearchRequestRejected(error)) {
          this.throwBackendRejected();
        }
        this.throwContinuationUnavailable();
      }
      if (isElasticsearchRequestRejected(error)) this.throwBackendRejected();
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Elasticsearch unavailable; using PostgreSQL fallback: ${message}`,
      );
      return this.searchPostgres(query, eligibilityDate);
    }
  }

  private async searchElasticsearch(
    query: JobSearchQueryDto,
    cursor: JobSearchCursor | null,
    eligibilityDate: string,
  ): Promise<JobSearchResultDto> {
    const cursorMode = query.pagination === JobSearchPaginationMode.CURSOR;
    const continuation = cursor !== null;
    const cursorExpiresAt =
      cursor?.expiresAt ?? Date.now() + JOB_SEARCH_CURSOR_TTL_MS;
    const must: estypes.QueryDslQueryContainer[] = [];
    const filter: estypes.QueryDslQueryContainer[] = [
      { term: { searchable: true } },
      { term: { status: JobStatus.PUBLISHED } },
      { range: { deadline: { gte: eligibilityDate } } },
    ];
    if (query.q) {
      must.push({
        multi_match: {
          query: query.q.normalize('NFKC').trim(),
          fields: ['title^4', 'description^2', 'skills^3', 'companyName^2'],
          type: 'best_fields',
          operator: 'and',
          fuzziness: 'AUTO',
          prefix_length: 1,
          max_expansions: 25,
        },
      });
    }
    if (query.location) {
      filter.push({
        match_phrase: {
          location: query.location.normalize('NFKC').trim(),
        },
      });
    }
    if (query.skills?.length) {
      filter.push({ terms: { 'skills.keyword': query.skills } });
    }
    if (query.jobType) {
      filter.push({ term: { jobType: query.jobType } });
    }
    if (query.companyId) {
      filter.push({ term: { companyId: query.companyId.toLowerCase() } });
    }
    if (query.experienceYears !== undefined) {
      filter.push({
        range: { experienceYears: { lte: query.experienceYears } },
      });
    }
    if (query.salaryMin !== undefined) {
      filter.push({
        bool: {
          should: [
            { term: { isNegotiable: true } },
            { range: { salaryMax: { gte: query.salaryMin } } },
          ],
          minimum_should_match: 1,
        },
      });
    }
    if (query.salaryMax !== undefined) {
      filter.push({
        bool: {
          should: [
            { term: { isNegotiable: true } },
            { range: { salaryMin: { lte: query.salaryMax } } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    let pitId = cursor?.pitId;
    let openedHere = false;
    let closeOnExit = false;
    let receivedPitResponse = false;
    try {
      if (cursorMode && pitId === undefined) {
        this.reservePitSlot();
        try {
          const opened = await this.elastic.openPointInTime({
            index: this.index,
            keep_alive: pitKeepAlive(cursorExpiresAt),
          });
          pitId = opened.id;
          openedHere = true;
          this.completePitOpen(pitId, cursorExpiresAt);
        } catch (error) {
          this.cancelPitOpen();
          throw error;
        }
      }
      const response = await this.elastic.search<JobSearchDocument>({
        ...(cursorMode
          ? {
              pit: {
                id: pitId!,
                keep_alive: pitKeepAlive(cursorExpiresAt),
              },
              ...(cursor === null
                ? {}
                : { search_after: cursor.searchAfter }),
            }
          : {
              index: this.index,
              from: (query.page - 1) * query.limit,
            }),
        size: query.limit,
        track_total_hits: !continuation,
        allow_partial_search_results: false,
        query: { bool: { must, filter } },
        sort: this.elasticsearchSort(query, cursorMode),
        ...(continuation
          ? {}
          : {
              aggs: {
                locations: { terms: { field: 'location.keyword', size: 30 } },
                skills: { terms: { field: 'skills.keyword', size: 50 } },
                jobTypes: { terms: { field: 'jobType', size: 10 } },
                companies: { terms: { field: 'companyId', size: 50 } },
              },
            }),
      });
      receivedPitResponse = cursorMode;
      const previousPitId = pitId;
      const latestPitId = response.pit_id ?? pitId;
      if (cursorMode) {
        pitId = latestPitId;
        this.rotateOwnedPit(previousPitId, latestPitId, cursorExpiresAt);
      }
      const shards = response._shards;
      if (
        response.timed_out ||
        (shards?.failed ?? 0) > 0 ||
        (shards !== undefined &&
          shards.successful + (shards.skipped ?? 0) < shards.total)
      ) {
        throw new Error('ELASTICSEARCH_PARTIAL_SEARCH_RESULTS');
      }
      const total = cursor?.total ?? (
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total?.value ?? 0)
      );
      const page = cursor?.page ?? query.page;
      const hasMore = response.hits.hits.length > 0 &&
        page * query.limit < total;
      let nextCursor: string | null = null;
      if (cursorMode && hasMore) {
        const searchAfter = response.hits.hits.at(-1)?.sort;
        if (!searchAfter || latestPitId === undefined) {
          throw new Error('ELASTICSEARCH_SEARCH_SORT_VALUES_MISSING');
        }
        nextCursor = this.cursor.encode(query, {
          pitId: latestPitId,
          searchAfter,
          page: page + 1,
          total,
          eligibilityDate,
          expiresAt: cursorExpiresAt,
        });
      } else if (cursorMode) {
        closeOnExit = true;
      }
      const aggregations = response.aggregations as
        | Record<string, BucketAggregation>
        | undefined;

      return {
        items: response.hits.hits.flatMap((hit) =>
          hit._source
            ? [this.fromDocument(hit._source, hit._score ?? null)]
            : [],
        ),
        total,
        page,
        limit: query.limit,
        hasMore,
        nextCursor,
        facets: {
          locations: this.bucketMap(aggregations?.locations),
          skills: this.bucketMap(aggregations?.skills),
          jobTypes: this.bucketMap(aggregations?.jobTypes),
          companies: this.bucketMap(aggregations?.companies),
        },
        source: JobSearchSource.ELASTICSEARCH,
      };
    } catch (error) {
      if (openedHere || receivedPitResponse) closeOnExit = true;
      throw error;
    } finally {
      if (closeOnExit && pitId !== undefined) {
        const closed = await this.closePointInTime(pitId);
        if (closed) this.ownedPits.delete(pitId);
      }
    }
  }

  private async searchPostgres(
    query: JobSearchQueryDto,
    eligibilityDate: string,
  ): Promise<JobSearchResultDto> {
    const today = new Date(`${eligibilityDate}T00:00:00.000Z`);
    const and: Prisma.JobWhereInput[] = [
      { status: JobStatus.PUBLISHED },
      { deadline: { gte: today } },
    ];
    if (query.q) {
      const term = query.q.normalize('NFKC').trim();
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { requirements: { contains: term, mode: 'insensitive' } },
          { skills: { has: term } },
        ],
      });
    }
    if (query.location) {
      and.push({
        location: {
          contains: query.location.normalize('NFKC').trim(),
          mode: 'insensitive',
        },
      });
    }
    if (query.skills?.length) and.push({ skills: { hasSome: query.skills } });
    if (query.jobType) and.push({ jobType: query.jobType });
    if (query.companyId) {
      and.push({ companyId: query.companyId.toLowerCase() });
    }
    if (query.experienceYears !== undefined) {
      and.push({ experienceYears: { lte: query.experienceYears } });
    }
    if (query.salaryMin !== undefined) {
      and.push({
        OR: [
          { isNegotiable: true },
          { salaryMax: { gte: query.salaryMin } },
        ],
      });
    }
    if (query.salaryMax !== undefined) {
      and.push({
        OR: [
          { isNegotiable: true },
          { salaryMin: { lte: query.salaryMax } },
        ],
      });
    }
    const where: Prisma.JobWhereInput = { AND: and };
    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy: this.postgresSort(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    const items = jobs.map((job) => this.fromJob(job));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      hasMore: query.page * query.limit < total,
      nextCursor: null,
      facets: this.pageFacets(items),
      source: JobSearchSource.POSTGRESQL,
    };
  }

  private validatePagination(query: JobSearchQueryDto): void {
    const mode = query.pagination ?? JobSearchPaginationMode.OFFSET;
    if (
      (query.cursor !== undefined && mode !== JobSearchPaginationMode.CURSOR) ||
      (mode === JobSearchPaginationMode.CURSOR && query.page !== 1)
    ) {
      throw new ApiException(
        'JOB_SEARCH_CURSOR_INVALID',
        'CURSOR pagination requires page=1, and a cursor requires pagination=CURSOR',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      mode === JobSearchPaginationMode.OFFSET &&
      query.page > Math.floor(ELASTICSEARCH_MAX_RESULT_WINDOW / query.limit)
    ) {
      throw new ApiException(
        'JOB_SEARCH_PAGE_TOO_DEEP',
        'Restart the search with pagination=CURSOR to go beyond 10000 results',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async closePointInTime(pitId: string): Promise<boolean> {
    try {
      const response = await this.elastic.closePointInTime({ id: pitId });
      return response.succeeded !== false;
    } catch (error) {
      if (isMissingPointInTime(error)) return true;
      const name = error instanceof Error && error.name
        ? error.name.slice(0, 100)
        : 'UnknownError';
      this.logger.warn(`Unable to close Elasticsearch search snapshot: ${name}`);
      return false;
    }
  }

  private reservePitSlot(now = Date.now()): void {
    for (const [pitId, expiresAt] of this.ownedPits) {
      if (expiresAt <= now) this.ownedPits.delete(pitId);
    }
    if (this.ownedPits.size + this.pendingPitOpens >= this.maxOpenPits) {
      throw new ApiException(
        'JOB_SEARCH_CURSOR_CAPACITY',
        'Stable Job search capacity is temporarily exhausted; retry later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.pendingPitOpens += 1;
  }

  private completePitOpen(pitId: string, expiresAt: number): void {
    this.pendingPitOpens = Math.max(0, this.pendingPitOpens - 1);
    this.ownedPits.set(pitId, expiresAt);
  }

  private cancelPitOpen(): void {
    this.pendingPitOpens = Math.max(0, this.pendingPitOpens - 1);
  }

  private rotateOwnedPit(
    previousPitId: string | undefined,
    latestPitId: string | undefined,
    expiresAt: number,
  ): void {
    if (previousPitId === undefined || latestPitId === undefined) return;
    const owned = this.ownedPits.delete(previousPitId);
    if (owned) this.ownedPits.set(latestPitId, expiresAt);
  }

  private throwCursorStale(): never {
    throw new ApiException(
      'JOB_SEARCH_CURSOR_STALE',
      'Job search cursor has expired; restart the search',
      HttpStatus.CONFLICT,
    );
  }

  private throwContinuationUnavailable(): never {
    throw new ApiException(
      'JOB_SEARCH_CONTINUATION_UNAVAILABLE',
      'Job search continuation is temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private throwBackendRejected(): never {
    throw new ApiException(
      'JOB_SEARCH_BACKEND_REJECTED',
      'Elasticsearch rejected the search request',
      HttpStatus.BAD_GATEWAY,
    );
  }

  private validateSalaryRange(query: JobSearchQueryDto): void {
    if (
      query.salaryMin !== undefined &&
      query.salaryMax !== undefined &&
      query.salaryMin > query.salaryMax
    ) {
      throw new ApiException(
        'INVALID_SALARY_FILTER',
        'salaryMin must not exceed salaryMax',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private elasticsearchSort(
    query: JobSearchQueryDto,
    cursorMode: boolean,
  ): estypes.Sort {
    const shardTieBreaker: estypes.Sort = cursorMode
      ? [{ _shard_doc: 'asc' }]
      : [];
    if (query.sort === JobSearchSort.SALARY_DESC) {
      return [
        { salaryMax: { order: 'desc', missing: '_last' } },
        { publishedAt: { order: 'desc', missing: '_last' } },
        { jobId: 'asc' },
        ...shardTieBreaker,
      ];
    }
    if (query.sort === JobSearchSort.NEWEST || !query.q) {
      return [
        { publishedAt: { order: 'desc', missing: '_last' } },
        { jobId: 'asc' },
        ...shardTieBreaker,
      ];
    }
    return [
      { _score: { order: 'desc' } },
      { publishedAt: { order: 'desc', missing: '_last' } },
      { jobId: 'asc' },
      ...shardTieBreaker,
    ];
  }

  private postgresSort(
    query: JobSearchQueryDto,
  ): Prisma.JobOrderByWithRelationInput[] {
    if (query.sort === JobSearchSort.SALARY_DESC) {
      return [
        { salaryMax: { sort: 'desc', nulls: 'last' } },
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ];
    }
    return [
      { publishedAt: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ];
  }

  private bucketMap(
    aggregation: BucketAggregation | undefined,
  ): Record<string, number> {
    if (!aggregation?.buckets || !Array.isArray(aggregation.buckets)) return {};
    return Object.fromEntries(
      aggregation.buckets.map((bucket) => [
        String(bucket.key),
        bucket.doc_count,
      ]),
    );
  }

  private fromDocument(
    document: JobSearchDocument,
    score: number | null,
  ): JobSearchItemDto {
    return {
      id: document.jobId,
      companyId: document.companyId,
      title: document.title,
      description: document.description,
      salaryMin: document.salaryMin?.toString() ?? null,
      salaryMax: document.salaryMax?.toString() ?? null,
      isNegotiable: document.isNegotiable,
      currency: document.currency,
      location: document.location,
      jobType: document.jobType,
      experienceYears: document.experienceYears,
      skills: document.skills,
      deadline: document.deadline.slice(0, 10),
      publishedAt: document.publishedAt ?? null,
      companyName: document.companyName ?? null,
      score,
    };
  }

  private fromJob(job: Job): JobSearchItemDto {
    return {
      id: job.id,
      companyId: job.companyId,
      title: job.title,
      description: job.description,
      salaryMin: job.salaryMin?.toString() ?? null,
      salaryMax: job.salaryMax?.toString() ?? null,
      isNegotiable: job.isNegotiable,
      currency: job.currency,
      location: job.location,
      jobType: job.jobType,
      experienceYears: job.experienceYears,
      skills: job.skills,
      deadline: job.deadline.toISOString().slice(0, 10),
      publishedAt: job.publishedAt?.toISOString() ?? null,
      companyName: null,
      score: null,
    };
  }

  private pageFacets(items: JobSearchItemDto[]): JobSearchFacetsDto {
    const facets: JobSearchFacetsDto = {
      locations: {},
      skills: {},
      jobTypes: {},
      companies: {},
    };
    for (const item of items) {
      this.increment(facets.locations, item.location);
      this.increment(facets.jobTypes, item.jobType);
      this.increment(facets.companies, item.companyId);
      for (const skill of item.skills) this.increment(facets.skills, skill);
    }
    return facets;
  }

  private increment(target: Record<string, number>, key: string): void {
    target[key] = (target[key] ?? 0) + 1;
  }
}

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function pitKeepAlive(expiresAt: number, now = Date.now()): string {
  return `${Math.max(1, expiresAt - now)}ms`;
}

function elasticsearchStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as {
    statusCode?: unknown;
    meta?: { statusCode?: unknown };
  };
  const status = record.meta?.statusCode ?? record.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function elasticsearchErrorLabel(error: unknown): string {
  const status = elasticsearchStatus(error);
  const name = error instanceof Error && error.name
    ? error.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80)
    : 'UnknownError';
  return `${name};status=${status ?? 'none'}`;
}

function isElasticsearchRequestRejected(error: unknown): boolean {
  const status = elasticsearchStatus(error);
  return status === 400 || status === 401 || status === 403;
}

function isMissingPointInTime(error: unknown): boolean {
  const status = elasticsearchStatus(error);
  if (status !== 404 || typeof error !== 'object' || error === null) {
    return false;
  }
  const details = (error as {
    meta?: {
      body?: {
        error?: {
          type?: unknown;
          reason?: unknown;
          root_cause?: Array<{ type?: unknown; reason?: unknown }>;
        };
      };
    };
  }).meta?.body?.error;
  const types = [details?.type, ...(details?.root_cause ?? []).map(
    (cause) => cause.type,
  )];
  if (types.includes('search_context_missing_exception')) return true;
  const reasons = [details?.reason, ...(details?.root_cause ?? []).map(
    (cause) => cause.reason,
  )].filter((reason): reason is string => typeof reason === 'string');
  return reasons.some((reason) =>
    reason.toLowerCase().includes('point in time'),
  );
}
