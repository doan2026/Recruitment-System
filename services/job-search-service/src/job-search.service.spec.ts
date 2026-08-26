import { ConfigService } from '@nestjs/config';
import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import {
  JobSearchQueryDto,
  JobSearchSort,
  JobSearchSource,
} from './job-search.dto';
import { JobIndexingService } from './job-indexing.service';
import { JobSearchService } from './job-search.service';
import { PrismaService } from './prisma.service';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function publishedJob(): Job {
  return {
    id: JOB_ID,
    companyId: COMPANY_ID,
    createdBy: '33333333-3333-4333-8333-333333333333',
    title: 'NestJS Engineer',
    description: 'Build a recruitment platform',
    requirements: 'Two years of experience',
    benefits: 'Remote work',
    salaryMin: new Prisma.Decimal(20_000_000),
    salaryMax: new Prisma.Decimal(30_000_000),
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 2,
    quantity: 2,
    skills: ['NestJS', 'PostgreSQL'],
    deadline: new Date('2099-12-31T00:00:00.000Z'),
    status: JobStatus.PUBLISHED,
    aggregateVersion: 1,
    publishedAt: new Date('2026-08-24T08:00:00.000Z'),
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-08-24T07:00:00.000Z'),
    updatedAt: new Date('2026-08-24T08:00:00.000Z'),
  };
}

function query(overrides: Partial<JobSearchQueryDto> = {}): JobSearchQueryDto {
  return {
    page: 1,
    limit: 20,
    sort: JobSearchSort.RELEVANCE,
    ...overrides,
  };
}

describe('JobSearchService', () => {
  let service: JobSearchService;
  let elasticSearch: jest.Mock;
  let transaction: jest.Mock;
  let indexReady: jest.Mock;

  beforeEach(() => {
    transaction = jest.fn();
    indexReady = jest.fn().mockReturnValue(true);
    const prisma = {
      job: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    service = new JobSearchService(
      prisma,
      new ConfigService({
        ELASTICSEARCH_NODE: 'http://elasticsearch:9200',
        ELASTICSEARCH_INDEX: 'job_index',
      }),
      { isSearchReady: indexReady } as unknown as JobIndexingService,
    );
    elasticSearch = jest.fn();
    Object.assign(service, { elastic: { search: elasticSearch } });
  });

  it('returns Elasticsearch hits, total and full-result facets', async () => {
    elasticSearch.mockResolvedValue({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [{
          _score: 8.5,
          _source: {
            jobId: JOB_ID,
            companyId: COMPANY_ID,
            companyName: 'Acme',
            title: 'NestJS Engineer',
            description: 'Build a recruitment platform',
            salaryMin: 20_000_000,
            salaryMax: 30_000_000,
            isNegotiable: false,
            currency: 'VND',
            location: 'Ha Noi',
            jobType: JobType.FULL_TIME,
            experienceYears: 2,
            skills: ['NestJS'],
            deadline: '2099-12-31',
            status: JobStatus.PUBLISHED,
            publishedAt: '2026-08-24T08:00:00.000Z',
          },
        }],
      },
      aggregations: {
        locations: { buckets: [{ key: 'Ha Noi', doc_count: 1 }] },
        skills: { buckets: [{ key: 'NestJS', doc_count: 1 }] },
        jobTypes: { buckets: [{ key: 'FULL_TIME', doc_count: 1 }] },
        companies: { buckets: [{ key: COMPANY_ID, doc_count: 1 }] },
      },
    });

    const result = await service.search(query({ q: 'NestJS' }));

    expect(result.source).toBe(JobSearchSource.ELASTICSEARCH);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: JOB_ID,
      companyName: 'Acme',
      score: 8.5,
    });
    expect(result.facets.skills).toEqual({ NestJS: 1 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('falls back to PostgreSQL when Elasticsearch fails', async () => {
    elasticSearch.mockRejectedValue(new Error('connection refused'));
    transaction.mockResolvedValue([1, [publishedJob()]]);

    const result = await service.search(
      query({
        location: 'Ha Noi',
        skills: ['NestJS'],
        salaryMin: 15_000_000,
      }),
    );

    expect(result.source).toBe(JobSearchSource.POSTGRESQL);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: JOB_ID,
      location: 'Ha Noi',
      companyName: null,
    });
    expect(result.facets.locations).toEqual({ 'Ha Noi': 1 });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it(
    'uses PostgreSQL while the Elasticsearch baseline is incomplete',
    async () => {
      indexReady.mockReturnValue(false);
      transaction.mockResolvedValue([1, [publishedJob()]]);

      const result = await service.search(query());

      expect(result.source).toBe(JobSearchSource.POSTGRESQL);
      expect(elasticSearch).not.toHaveBeenCalled();
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects an inverted salary range before querying a backend', async () => {
    await expect(
      service.search(query({ salaryMin: 30, salaryMax: 20 })),
    ).rejects.toMatchObject({ code: 'INVALID_SALARY_FILTER' });
    expect(elasticSearch).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
