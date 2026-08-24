import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, estypes } from '@elastic/elasticsearch';
import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import { ApiException } from './common';
import {
  JobSearchFacetsDto,
  JobSearchItemDto,
  JobSearchQueryDto,
  JobSearchResultDto,
  JobSearchSort,
  JobSearchSource,
} from './job-search.dto';
import { PrismaService } from './prisma.service';

interface JobSearchDocument {
  jobId: string;
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

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
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
    this.index = config.get<string>('ELASTICSEARCH_INDEX') ?? 'job_index';
  }

  async search(query: JobSearchQueryDto): Promise<JobSearchResultDto> {
    this.validateSalaryRange(query);
    try {
      return await this.searchElasticsearch(query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Elasticsearch unavailable; using PostgreSQL fallback: ${message}`,
      );
      return this.searchPostgres(query);
    }
  }

  private async searchElasticsearch(
    query: JobSearchQueryDto,
  ): Promise<JobSearchResultDto> {
    const must: estypes.QueryDslQueryContainer[] = [];
    const filter: estypes.QueryDslQueryContainer[] = [
      { term: { status: JobStatus.PUBLISHED } },
      { range: { deadline: { gte: 'now/d' } } },
    ];
    if (query.q) {
      must.push({
        multi_match: {
          query: query.q.normalize('NFKC').trim(),
          fields: ['title^4', 'description^2', 'skills^3', 'companyName^2'],
          type: 'best_fields',
          fuzziness: 'AUTO',
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
      filter.push({ term: { companyId: query.companyId } });
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

    const response = await this.elastic.search<JobSearchDocument>({
      index: this.index,
      from: (query.page - 1) * query.limit,
      size: query.limit,
      track_total_hits: true,
      query: { bool: { must, filter } },
      sort: this.elasticsearchSort(query),
      aggs: {
        locations: { terms: { field: 'location.keyword', size: 30 } },
        skills: { terms: { field: 'skills.keyword', size: 50 } },
        jobTypes: { terms: { field: 'jobType', size: 10 } },
        companies: { terms: { field: 'companyId', size: 50 } },
      },
    });
    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total?.value ?? 0);
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
      page: query.page,
      limit: query.limit,
      facets: {
        locations: this.bucketMap(aggregations?.locations),
        skills: this.bucketMap(aggregations?.skills),
        jobTypes: this.bucketMap(aggregations?.jobTypes),
        companies: this.bucketMap(aggregations?.companies),
      },
      source: JobSearchSource.ELASTICSEARCH,
    };
  }

  private async searchPostgres(
    query: JobSearchQueryDto,
  ): Promise<JobSearchResultDto> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
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
    if (query.companyId) and.push({ companyId: query.companyId });
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
      facets: this.pageFacets(items),
      source: JobSearchSource.POSTGRESQL,
    };
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

  private elasticsearchSort(query: JobSearchQueryDto): estypes.Sort {
    if (query.sort === JobSearchSort.SALARY_DESC) {
      return [
        { salaryMax: { order: 'desc', missing: '_last' } },
        { publishedAt: 'desc' },
      ];
    }
    if (query.sort === JobSearchSort.NEWEST || !query.q) {
      return [{ publishedAt: 'desc' }];
    }
    return ['_score', { publishedAt: 'desc' }];
  }

  private postgresSort(
    query: JobSearchQueryDto,
  ): Prisma.JobOrderByWithRelationInput[] {
    if (query.sort === JobSearchSort.SALARY_DESC) {
      return [
        { salaryMax: { sort: 'desc', nulls: 'last' } },
        { publishedAt: 'desc' },
      ];
    }
    return [{ publishedAt: 'desc' }];
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
