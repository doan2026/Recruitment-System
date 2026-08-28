import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JobIndexingService } from './job-indexing.service';
import { JobRecommendationService } from './job-recommendation.service';
import { RecruiterCandidateRecommendationService } from './recruiter-candidate-recommendation.service';
import { JobController } from './job.controller';
import {
  JobSearchPaginationMode,
  JobSearchQueryDto,
  JobSearchSort,
} from './job-search.dto';
import { JobSearchService } from './job-search.service';
import { JobService } from './job.service';

describe('Job search query contract', () => {
  it('applies backward-compatible defaults without requiring a cursor', async () => {
    const dto = plainToInstance(JobSearchQueryDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      sort: JobSearchSort.RELEVANCE,
      page: 1,
      limit: 20,
      pagination: JobSearchPaginationMode.OFFSET,
    });
    expect(dto.cursor).toBeUndefined();
  });

  it('accepts the maximum page size, skill count and cursor length', async () => {
    const dto = plainToInstance(JobSearchQueryDto, {
      limit: '50',
      skills: Array.from({ length: 50 }, (_, index) => `skill-${index}`),
      pagination: JobSearchPaginationMode.CURSOR,
      cursor: 'c'.repeat(4096),
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(dto.skills).toHaveLength(50);
    expect(dto.cursor).toHaveLength(4096);
  });

  it('accepts page values only through Number.MAX_SAFE_INTEGER', async () => {
    const maximum = plainToInstance(JobSearchQueryDto, {
      page: String(Number.MAX_SAFE_INTEGER),
    });
    const unsafe = plainToInstance(JobSearchQueryDto, {
      page: String(Number.MAX_SAFE_INTEGER + 1),
    });

    expect(await validate(maximum)).toHaveLength(0);
    expect(maximum.page).toBe(Number.MAX_SAFE_INTEGER);
    expect(await validate(unsafe)).not.toHaveLength(0);
  });

  it.each([
    ['empty cursor', { cursor: '' }],
    ['oversized cursor', { cursor: 'c'.repeat(4097) }],
    ['non-string cursor', { cursor: 123 }],
    ['zero limit', { limit: 0 }],
    ['limit above 50', { limit: 51 }],
    ['fractional limit', { limit: 1.5 }],
    ['zero page', { page: 0 }],
    ['fractional page', { page: 1.5 }],
    ['unknown pagination mode', { pagination: 'KEYSET' }],
    ['unknown sort', { sort: 'OLDEST' }],
    ['invalid company UUID', { companyId: 'not-a-uuid' }],
    [
      'more than 50 skills',
      { skills: Array.from({ length: 51 }, (_, index) => `skill-${index}`) },
    ],
  ])('rejects %s', async (_label, value) => {
    const dto = plainToInstance(JobSearchQueryDto, value);

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects non-whitelisted search parameters through the global policy', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(pipe.transform(
      { cursor: 'opaque', userId: '11111111-1111-4111-8111-111111111111' },
      {
        type: 'query',
        metatype: JobSearchQueryDto,
        data: undefined,
      },
    )).rejects.toBeDefined();
  });

  it('marks public search and PIT cursors as non-cacheable', async () => {
    const search = jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      facets: { locations: {}, skills: {}, jobTypes: {}, companies: {} },
      source: 'ELASTICSEARCH',
      nextCursor: null,
      hasMore: false,
    });
    const controller = new JobController(
      {} as JobService,
      { search } as unknown as JobSearchService,
      {} as JobRecommendationService,
      {} as JobIndexingService,
      {} as RecruiterCandidateRecommendationService,
    );
    const setHeader = jest.fn();
    const query = plainToInstance(JobSearchQueryDto, {});

    await controller.search(query, { setHeader });

    expect(search).toHaveBeenCalledWith(query);
    expect(setHeader.mock.calls).toEqual([
      ['Cache-Control', 'no-store'],
      ['Pragma', 'no-cache'],
    ]);
  });
});
