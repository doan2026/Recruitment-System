import { ConfigService } from '@nestjs/config';
import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import {
  JobSearchPaginationMode,
  JobSearchQueryDto,
  JobSearchSort,
  JobSearchSource,
} from './job-search.dto';
import {
  JOB_SEARCH_CURSOR_TTL_MS,
  JobSearchCursorService,
  JobSearchCursorState,
} from './job-search-cursor.service';
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
    pagination: JobSearchPaginationMode.OFFSET,
    ...overrides,
  };
}

describe('JobSearchService', () => {
  let service: JobSearchService;
  let elasticSearch: jest.Mock;
  let openPointInTime: jest.Mock;
  let closePointInTime: jest.Mock;
  let transaction: jest.Mock;
  let findMany: jest.Mock;
  let indexReady: jest.Mock;
  let cursorDecode: jest.Mock;
  let cursorEncode: jest.Mock;
  let prisma: PrismaService;
  let indexing: JobIndexingService;
  let cursorService: JobSearchCursorService;

  beforeEach(() => {
    transaction = jest.fn();
    findMany = jest.fn();
    indexReady = jest.fn().mockReturnValue(true);
    cursorDecode = jest.fn().mockReturnValue(null);
    cursorEncode = jest.fn().mockReturnValue('next-cursor');
    prisma = {
      job: {
        count: jest.fn(),
        findMany,
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    indexing = {
      isSearchReady: indexReady,
    } as unknown as JobIndexingService;
    cursorService = {
      decode: cursorDecode,
      encode: cursorEncode,
    } as unknown as JobSearchCursorService;
    elasticSearch = jest.fn();
    openPointInTime = jest.fn().mockResolvedValue({ id: 'pit-1' });
    closePointInTime = jest.fn().mockResolvedValue({ succeeded: true });
    installService();
  });

  function installService(maxOpenPits?: string): void {
    service = new JobSearchService(
      prisma,
      new ConfigService({
        ELASTICSEARCH_NODE: 'http://elasticsearch:9200',
        ELASTICSEARCH_INDEX: 'job_index',
        ...(maxOpenPits === undefined
          ? {}
          : { JOB_SEARCH_MAX_OPEN_PITS: maxOpenPits }),
      }),
      indexing,
      cursorService,
    );
    Object.assign(service, {
      elastic: { search: elasticSearch, openPointInTime, closePointInTime },
    });
  }

  it('uses backward-compatible OFFSET search without opening a PIT', async () => {
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
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
    expect(openPointInTime).not.toHaveBeenCalled();
    expect(closePointInTime).not.toHaveBeenCalled();
    expect(cursorEncode).not.toHaveBeenCalled();
    const request = elasticSearch.mock.calls[0][0];
    expect(request.index).toBe('job_index');
    expect(request.from).toBe(0);
    expect(request).not.toHaveProperty('pit');
    expect(request.allow_partial_search_results).toBe(false);
    expect(request.track_total_hits).toBe(true);
    expect(request.sort).toEqual([
      { _score: { order: 'desc' } },
      { publishedAt: { order: 'desc', missing: '_last' } },
      { jobId: 'asc' },
    ]);
    expect(JSON.stringify(request.sort)).not.toContain('_shard_doc');
    expect(request.query.bool.filter).toEqual(expect.arrayContaining([
      { range: { deadline: { gte: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } } },
    ]));
    expect(request.query.bool.must).toEqual([{
      multi_match: expect.objectContaining({
        query: 'NestJS',
        type: 'best_fields',
        operator: 'and',
        fuzziness: 'AUTO',
        prefix_length: 1,
        max_expansions: 25,
      }),
    }]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns a signed continuation from PIT sort values and stable sorts',
  async () => {
    const beforeSearch = Date.now();
    elasticSearch.mockResolvedValue({
      pit_id: 'pit-2',
      hits: {
        total: { value: 2, relation: 'eq' },
        hits: [{
          _score: null,
          sort: [1_777_777_777_000, JOB_ID, 7],
          _source: elasticDocument(),
        }],
      },
      aggregations: {},
    });

    const result = await service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      sort: JobSearchSort.NEWEST,
      limit: 1,
    }));
    const afterSearch = Date.now();

    expect(result).toMatchObject({
      page: 1,
      hasMore: true,
      nextCursor: 'next-cursor',
    });
    const openRequest = openPointInTime.mock.calls[0][0];
    expect(openRequest.index).toBe('job_index');
    expect(openRequest).not.toHaveProperty('allow_partial_search_results');
    expectKeepAliveWithinTtl(openRequest.keep_alive);
    expect(cursorEncode).toHaveBeenCalledWith(
      expect.objectContaining({ sort: JobSearchSort.NEWEST, limit: 1 }),
      expect.objectContaining({
        pitId: 'pit-2',
        searchAfter: [1_777_777_777_000, JOB_ID, 7],
        page: 2,
        total: 2,
        eligibilityDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        expiresAt: expect.any(Number),
      }),
    );
    const encodedState = cursorEncode.mock.calls[0][1] as JobSearchCursorState;
    expect(encodedState.expiresAt).toBeGreaterThanOrEqual(
      beforeSearch + JOB_SEARCH_CURSOR_TTL_MS,
    );
    expect(encodedState.expiresAt).toBeLessThanOrEqual(
      afterSearch + JOB_SEARCH_CURSOR_TTL_MS,
    );
    expect(closePointInTime).not.toHaveBeenCalled();
    const request = elasticSearch.mock.calls[0][0];
    expect(request).not.toHaveProperty('index');
    expect(request).not.toHaveProperty('from');
    expect(request.pit.id).toBe('pit-1');
    expectKeepAliveWithinTtl(request.pit.keep_alive);
    expect(request.allow_partial_search_results).toBe(false);
    expect(request.sort).toEqual([
      { publishedAt: { order: 'desc', missing: '_last' } },
      { jobId: 'asc' },
      { _shard_doc: 'asc' },
    ]);
  });

  it('continues with search_after and the cursor PIT without an offset',
  async () => {
    const expiresAt = Date.now() + JOB_SEARCH_CURSOR_TTL_MS / 2;
    cursorDecode.mockReturnValue(cursorState({ expiresAt }));
    elasticSearch.mockResolvedValue({
      pit_id: 'pit-refreshed',
      hits: {
        hits: [{
          _score: null,
          sort: [1_777_777_776_000, JOB_ID, 8],
          _source: elasticDocument(),
        }],
      },
      aggregations: {},
    });

    const result = await service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      sort: JobSearchSort.NEWEST,
      limit: 1,
      cursor: 'cursor-page-2',
    }));

    expect(result).toMatchObject({
      page: 2,
      total: 3,
      hasMore: true,
      facets: { locations: {}, skills: {}, jobTypes: {}, companies: {} },
    });
    expect(openPointInTime).not.toHaveBeenCalled();
    const request = elasticSearch.mock.calls[0][0];
    expect(request).not.toHaveProperty('from');
    expect(request.search_after).toEqual([
      1_777_777_777_000,
      JOB_ID,
      7,
    ]);
    expect(request.pit.id).toBe('pit-existing');
    expectKeepAliveWithinTtl(
      request.pit.keep_alive,
      JOB_SEARCH_CURSOR_TTL_MS / 2,
    );
    expect(request.allow_partial_search_results).toBe(false);
    expect(request.track_total_hits).toBe(false);
    expect(request).not.toHaveProperty('aggs');
    expect(cursorEncode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pitId: 'pit-refreshed',
        page: 3,
        total: 3,
        expiresAt,
      }),
    );
  });

  it('closes the latest PIT id returned by Elasticsearch on a terminal page',
  async () => {
    elasticSearch.mockResolvedValue({
      pit_id: 'pit-latest',
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [{
          _score: null,
          sort: [1_777_777_777_000, JOB_ID, 7],
          _source: elasticDocument(),
        }],
      },
      aggregations: {},
    });

    const result = await service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      sort: JobSearchSort.NEWEST,
    }));

    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
    expect(closePointInTime).toHaveBeenCalledWith({ id: 'pit-latest' });
    expect(closePointInTime).not.toHaveBeenCalledWith({ id: 'pit-1' });
  });

  it('reports OFFSET hasMore without issuing a continuation cursor', async () => {
    elasticSearch.mockResolvedValue({
      hits: {
        total: { value: 2, relation: 'eq' },
        hits: [{ _score: null, _source: elasticDocument() }],
      },
      aggregations: {},
    });

    const result = await service.search(query({ limit: 1 }));

    expect(result).toMatchObject({ hasMore: true, nextCursor: null });
    expect(openPointInTime).not.toHaveBeenCalled();
    expect(cursorEncode).not.toHaveBeenCalled();
  });

  it.each([JobSearchSort.NEWEST, JobSearchSort.SALARY_DESC])(
    'keeps _shard_doc out of %s OFFSET sorting',
    async (sort) => {
      elasticSearch.mockResolvedValue({
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
        aggregations: {},
      });

      await service.search(query({ sort }));

      const requestSort = elasticSearch.mock.calls[0][0].sort;
      expect(JSON.stringify(requestSort)).not.toContain('_shard_doc');
      expect(requestSort.at(-1)).toEqual({ jobId: 'asc' });
    },
  );

  it('normalizes an uppercase company UUID before Elasticsearch filtering',
  async () => {
    elasticSearch.mockResolvedValue({
      hits: { total: { value: 0, relation: 'eq' }, hits: [] },
      aggregations: {},
    });

    await service.search(query({ companyId: COMPANY_ID.toUpperCase() }));

    expect(elasticSearch.mock.calls[0][0].query.bool.filter).toEqual(
      expect.arrayContaining([{ term: { companyId: COMPANY_ID } }]),
    );
  });

  it('falls back to PostgreSQL when Elasticsearch fails', async () => {
    elasticSearch.mockRejectedValue(new Error('connection refused'));
    transaction.mockResolvedValue([2, [publishedJob()]]);

    const result = await service.search(
      query({
        location: 'Ha Noi',
        skills: ['NestJS'],
        salaryMin: 15_000_000,
        limit: 1,
      }),
    );

    expect(result.source).toBe(JobSearchSource.POSTGRESQL);
    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({
      id: JOB_ID,
      location: 'Ha Noi',
      companyName: null,
    });
    expect(result.facets.locations).toEqual({ 'Ha Noi': 1 });
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(true);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
    }));
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('normalizes an uppercase company UUID in PostgreSQL fallback', async () => {
    elasticSearch.mockRejectedValue(new Error('connection refused'));
    transaction.mockResolvedValue([0, []]);

    await service.search(query({ companyId: COMPANY_ID.toUpperCase() }));

    expect(findMany.mock.calls[0][0].where.AND).toEqual(
      expect.arrayContaining([{ companyId: COMPANY_ID }]),
    );
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

  it('rejects legacy offset pages beyond the Elasticsearch result window',
  async () => {
    await expect(service.search(query({ page: 201, limit: 50 })))
      .rejects.toMatchObject({ code: 'JOB_SEARCH_PAGE_TOO_DEEP' });

    expect(cursorDecode).not.toHaveBeenCalled();
    expect(openPointInTime).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not mix a cursor continuation with an explicit offset page',
  async () => {
    await expect(service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      cursor: 'opaque',
      page: 2,
    })))
      .rejects.toMatchObject({ code: 'JOB_SEARCH_CURSOR_INVALID' });

    expect(cursorDecode).not.toHaveBeenCalled();
  });

  it('rejects a cursor supplied in OFFSET compatibility mode', async () => {
    await expect(service.search(query({ cursor: 'opaque' })))
      .rejects.toMatchObject({ code: 'JOB_SEARCH_CURSOR_INVALID' });

    expect(cursorDecode).not.toHaveBeenCalled();
    expect(elasticSearch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403])(
    'does not hide Elasticsearch client status %s behind PostgreSQL',
  async (statusCode) => {
    elasticSearch.mockRejectedValue({ meta: { statusCode } });

    await expect(service.search(query())).rejects.toMatchObject({
      code: 'JOB_SEARCH_BACKEND_REJECTED',
      status: 502,
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(openPointInTime).not.toHaveBeenCalled();
    expect(closePointInTime).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a missing index',
      {
        meta: {
          statusCode: 404,
          body: { error: { type: 'index_not_found_exception' } },
        },
      },
    ],
    ['an Elasticsearch timeout', { meta: { statusCode: 408 } }],
    ['Elasticsearch throttling', { meta: { statusCode: 429 } }],
  ])('falls back to PostgreSQL for %s in OFFSET mode', async (_label, error) => {
    elasticSearch.mockRejectedValue(error);
    transaction.mockResolvedValue([1, [publishedJob()]]);

    const result = await service.search(query());

    expect(result.source).toBe(JobSearchSource.POSTGRESQL);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('fails a continuation closed instead of falling back to PostgreSQL',
  async () => {
    cursorDecode.mockReturnValue(cursorState());
    elasticSearch.mockRejectedValue(new Error('connection refused'));

    await expect(service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      cursor: 'opaque',
    })))
      .rejects.toMatchObject({
        code: 'JOB_SEARCH_CONTINUATION_UNAVAILABLE',
        status: 503,
      });
    expect(transaction).not.toHaveBeenCalled();
    expect(closePointInTime).not.toHaveBeenCalled();
  });

  it('maps an expired PIT continuation to a cursor-stale conflict',
  async () => {
    cursorDecode.mockReturnValue(cursorState({
      pitId: 'pit-expired',
    }));
    elasticSearch.mockRejectedValue({
      meta: {
        statusCode: 404,
        body: { error: { type: 'search_context_missing_exception' } },
      },
    });

    await expect(service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      cursor: 'opaque',
    })))
      .rejects.toMatchObject({ code: 'JOB_SEARCH_CURSOR_STALE', status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('fails cursor continuation while the baseline is incomplete',
  async () => {
    indexReady.mockReturnValue(false);
    cursorDecode.mockReturnValue(cursorState());

    await expect(service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      cursor: 'opaque',
    })))
      .rejects.toMatchObject({
        code: 'JOB_SEARCH_CONTINUATION_UNAVAILABLE',
        status: 503,
      });
    expect(transaction).not.toHaveBeenCalled();
    expect(elasticSearch).not.toHaveBeenCalled();
  });

  it('rejects partial Elasticsearch shards and falls back in OFFSET mode',
  async () => {
    elasticSearch.mockResolvedValue({
      _shards: { total: 2, successful: 1, skipped: 0, failed: 1 },
      hits: { total: { value: 1, relation: 'eq' }, hits: [] },
      aggregations: {},
    });
    transaction.mockResolvedValue([1, [publishedJob()]]);

    const result = await service.search(query());

    expect(result.source).toBe(JobSearchSource.POSTGRESQL);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(elasticSearch.mock.calls[0][0].allow_partial_search_results)
      .toBe(false);
  });

  it('rejects partial shards fail-closed during CURSOR continuation',
  async () => {
    cursorDecode.mockReturnValue(cursorState());
    elasticSearch.mockResolvedValue({
      _shards: { total: 2, successful: 1, skipped: 0, failed: 1 },
      pit_id: 'pit-refreshed',
      hits: { total: { value: 2, relation: 'eq' }, hits: [] },
      aggregations: {},
    });

    await expect(service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
      cursor: 'opaque',
    }))).rejects.toMatchObject({
      code: 'JOB_SEARCH_CONTINUATION_UNAVAILABLE',
      status: 503,
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(closePointInTime).toHaveBeenCalledWith({ id: 'pit-refreshed' });
    expect(closePointInTime).not.toHaveBeenCalledWith({ id: 'pit-existing' });
  });

  it.each([
    {
      label: 'a timed-out response',
      timedOut: true,
      shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    },
    {
      label: 'an incomplete shard response',
      timedOut: false,
      shards: { total: 3, successful: 1, skipped: 1, failed: 0 },
    },
  ])('closes the rotated PIT after $label', async ({ timedOut, shards }) => {
    elasticSearch.mockResolvedValue({
      timed_out: timedOut,
      _shards: shards,
      pit_id: 'pit-rotated-before-validation',
      hits: { total: { value: 1, relation: 'eq' }, hits: [] },
      aggregations: {},
    });

    await expect(service.search(query({
      pagination: JobSearchPaginationMode.CURSOR,
    }))).rejects.toMatchObject({
      code: 'JOB_SEARCH_CONTINUATION_UNAVAILABLE',
      status: 503,
    });

    expect(closePointInTime).toHaveBeenCalledWith({
      id: 'pit-rotated-before-validation',
    });
    expect(closePointInTime).not.toHaveBeenCalledWith({ id: 'pit-1' });
  });

  it.each([
    {
      label: 'timed out',
      timed_out: true,
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    },
    {
      label: 'has incomplete shards',
      timed_out: false,
      _shards: { total: 2, successful: 1, skipped: 0, failed: 0 },
    },
  ])('falls back for an OFFSET response that $label', async (failure) => {
    elasticSearch.mockResolvedValue({
      ...failure,
      hits: { total: { value: 1, relation: 'eq' }, hits: [] },
      aggregations: {},
    });
    transaction.mockResolvedValue([1, [publishedJob()]]);

    const result = await service.search(query());

    expect(result.source).toBe(JobSearchSource.POSTGRESQL);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(closePointInTime).not.toHaveBeenCalled();
  });

  it('uses a default admission cap of 64 and accepts the configured maximum',
  () => {
    expect(serviceCapacity(service)).toBe(64);

    installService('1024');

    expect(serviceCapacity(service)).toBe(1024);
  });

  it.each(['', '0', '-1', '1.5', '1025', 'NaN', 'Infinity'])(
    'rejects invalid JOB_SEARCH_MAX_OPEN_PITS=%j',
    (configured) => {
      expect(() => installService(configured)).toThrow(
        /JOB_SEARCH_MAX_OPEN_PITS must be an integer from 1 to 1024/,
      );
    },
  );

  it('counts pending opens and returns 429 at concurrent capacity', async () => {
    installService('1');
    const gate = deferred<{ id: string }>();
    openPointInTime.mockReturnValueOnce(gate.promise);
    elasticSearch.mockResolvedValue(terminalPitResponse('pit-first-latest'));
    const cursorQuery = query({ pagination: JobSearchPaginationMode.CURSOR });

    const first = service.search(cursorQuery);
    expect(openPointInTime).toHaveBeenCalledTimes(1);

    await expect(service.search(cursorQuery)).rejects.toMatchObject({
      code: 'JOB_SEARCH_CURSOR_CAPACITY',
      status: 429,
    });
    expect(openPointInTime).toHaveBeenCalledTimes(1);

    gate.resolve({ id: 'pit-first' });
    await expect(first).resolves.toMatchObject({ nextCursor: null });
  });

  it('releases a pending reservation when opening a PIT fails', async () => {
    installService('1');
    openPointInTime
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce({ id: 'pit-after-failure' });
    elasticSearch.mockResolvedValue(terminalPitResponse('pit-after-latest'));
    const cursorQuery = query({ pagination: JobSearchPaginationMode.CURSOR });

    await expect(service.search(cursorQuery)).rejects.toMatchObject({
      code: 'JOB_SEARCH_CONTINUATION_UNAVAILABLE',
      status: 503,
    });
    await expect(service.search(cursorQuery)).resolves.toMatchObject({
      nextCursor: null,
    });

    expect(openPointInTime).toHaveBeenCalledTimes(2);
    expect(closePointInTime).toHaveBeenCalledWith({ id: 'pit-after-latest' });
  });

  it('releases capacity after a terminal PIT closes successfully', async () => {
    installService('1');
    openPointInTime
      .mockResolvedValueOnce({ id: 'pit-a' })
      .mockResolvedValueOnce({ id: 'pit-b' });
    elasticSearch
      .mockResolvedValueOnce(terminalPitResponse('pit-a-latest'))
      .mockResolvedValueOnce(terminalPitResponse('pit-b-latest'));
    const cursorQuery = query({ pagination: JobSearchPaginationMode.CURSOR });

    await service.search(cursorQuery);
    await service.search(cursorQuery);

    expect(openPointInTime).toHaveBeenCalledTimes(2);
    expect(closePointInTime.mock.calls).toEqual([
      [{ id: 'pit-a-latest' }],
      [{ id: 'pit-b-latest' }],
    ]);
  });

  it('holds abandoned PIT capacity only until the absolute cursor expiry',
  async () => {
    installService('1');
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    openPointInTime
      .mockResolvedValueOnce({ id: 'pit-abandoned' })
      .mockResolvedValueOnce({ id: 'pit-after-expiry' });
    elasticSearch
      .mockResolvedValueOnce(nonTerminalPitResponse('pit-abandoned-latest'))
      .mockResolvedValueOnce(terminalPitResponse('pit-after-expiry-latest'));
    const cursorQuery = query({
      pagination: JobSearchPaginationMode.CURSOR,
      limit: 1,
      sort: JobSearchSort.NEWEST,
    });

    try {
      await expect(service.search(cursorQuery)).resolves.toMatchObject({
        nextCursor: 'next-cursor',
      });
      await expect(service.search(cursorQuery)).rejects.toMatchObject({
        code: 'JOB_SEARCH_CURSOR_CAPACITY',
        status: 429,
      });

      nowSpy.mockReturnValue(now + JOB_SEARCH_CURSOR_TTL_MS + 1);
      await expect(service.search(cursorQuery)).resolves.toMatchObject({
        nextCursor: null,
      });
    } finally {
      nowSpy.mockRestore();
    }

    expect(openPointInTime).toHaveBeenCalledTimes(2);
  });
});

function elasticDocument(): Record<string, unknown> {
  return {
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
  };
}

function cursorState(
  overrides: Partial<JobSearchCursorState> = {},
): JobSearchCursorState {
  return {
    pitId: 'pit-existing',
    searchAfter: [1_777_777_777_000, JOB_ID, 7],
    page: 2,
    total: 3,
    eligibilityDate: '2026-08-29',
    expiresAt: Date.now() + JOB_SEARCH_CURSOR_TTL_MS / 2,
    ...overrides,
  };
}

function terminalPitResponse(pitId: string): Record<string, unknown> {
  return {
    pit_id: pitId,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: { total: { value: 0, relation: 'eq' }, hits: [] },
    aggregations: {},
  };
}

function nonTerminalPitResponse(pitId: string): Record<string, unknown> {
  return {
    pit_id: pitId,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: {
      total: { value: 2, relation: 'eq' },
      hits: [{
        _score: null,
        sort: [1_777_777_777_000, JOB_ID, 1],
        _source: elasticDocument(),
      }],
    },
    aggregations: {},
  };
}

function expectKeepAliveWithinTtl(
  value: unknown,
  upperBound = JOB_SEARCH_CURSOR_TTL_MS,
): void {
  expect(value).toEqual(expect.stringMatching(/^\d+ms$/));
  const milliseconds = Number(String(value).slice(0, -2));
  expect(milliseconds).toBeGreaterThan(0);
  expect(milliseconds).toBeLessThanOrEqual(upperBound);
  expect(milliseconds).toBeGreaterThanOrEqual(Math.max(1, upperBound - 5_000));
}

function serviceCapacity(service: JobSearchService): number {
  return (service as unknown as { maxOpenPits: number }).maxOpenPits;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
