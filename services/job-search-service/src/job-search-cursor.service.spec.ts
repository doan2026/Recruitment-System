import { ConfigService } from '@nestjs/config';
import { JobType } from '@prisma/client';
import { createHmac } from 'crypto';
import {
  JOB_SEARCH_CURSOR_MAX_PAGE,
  JOB_SEARCH_CURSOR_TTL_MS,
  JOB_SEARCH_MAX_CURSOR_LENGTH,
  JobSearchCursorService,
  JobSearchCursorState,
} from './job-search-cursor.service';
import {
  JobSearchPaginationMode,
  JobSearchQueryDto,
  JobSearchSort,
} from './job-search.dto';

const KEY = 'job-search-cursor-secret-32-bytes-minimum-2026';
const OTHER_KEY = 'other-job-search-cursor-secret-minimum-2026';
const JOB_ID = 'a1111111-a111-4111-8111-a11111111111';
const COMPANY_ID = 'b2222222-b222-4222-8222-b22222222222';
const OTHER_COMPANY_ID = 'c3333333-c333-4333-8333-c33333333333';
const PUBLISHED_AT = Date.parse('2026-08-29T01:02:03.004Z');
const PIT_ID = 'pit-id+/=_opaque-token';
const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const EXPIRES_AT = NOW + JOB_SEARCH_CURSOR_TTL_MS;

describe('JobSearchCursorService', () => {
  const service = createService(KEY);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    {
      label: 'newest',
      query: query({ sort: JobSearchSort.NEWEST }),
      searchAfter: [PUBLISHED_AT, JOB_ID, 4_294_967_298],
    },
    {
      label: 'newest with a missing-last published date',
      query: query({ sort: JobSearchSort.NEWEST }),
      searchAfter: [null, JOB_ID, 4_294_967_299],
    },
    {
      label: 'relevance without a query',
      query: query({ sort: JobSearchSort.RELEVANCE }),
      searchAfter: [PUBLISHED_AT, JOB_ID, 12],
    },
    {
      label: 'relevance with a query',
      query: query({ q: 'kỹ sư dữ liệu' }),
      searchAfter: [8.125, PUBLISHED_AT, JOB_ID, 99],
    },
    {
      label: 'relevance with a missing-last published date',
      query: query({ q: 'kỹ sư dữ liệu' }),
      searchAfter: [8.125, null, JOB_ID, 100],
    },
    {
      label: 'salary with a present value',
      query: query({ sort: JobSearchSort.SALARY_DESC }),
      searchAfter: [35_000_000, PUBLISHED_AT, JOB_ID, 100],
    },
    {
      label: 'salary with a missing-last value',
      query: query({ sort: JobSearchSort.SALARY_DESC }),
      searchAfter: [null, PUBLISHED_AT, JOB_ID, 101],
    },
    {
      label: 'salary with the Elasticsearch missing-double sentinel',
      query: query({ sort: JobSearchSort.SALARY_DESC }),
      searchAfter: ['-Infinity', PUBLISHED_AT, JOB_ID, 101],
    },
    {
      label: 'salary with missing-last salary and published date values',
      query: query({ sort: JobSearchSort.SALARY_DESC }),
      searchAfter: [null, null, JOB_ID, 102],
    },
  ])('round-trips a canonical signed $label PIT cursor', ({
    query: scopedQuery,
    searchAfter,
  }) => {
    const state = cursorState(searchAfter);
    const encoded = service.encode(scopedQuery, state);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(encoded).not.toContain('=');
    expect(encoded.length).toBeLessThanOrEqual(JOB_SEARCH_MAX_CURSOR_LENGTH);
    expect(service.decode(encoded, scopedQuery)).toEqual(state);
    expect(service.decode(undefined, scopedQuery)).toBeNull();
  });

  it('binds the SHA-256 scope to every semantic filter, sort and limit', () => {
    const scopedQuery = query({
      q: 'Kỹ sư dữ liệu',
      location: 'Hà Nội',
      salaryMin: 10_000_000,
      salaryMax: 50_000_000,
      skills: ['NestJS', 'PostgreSQL'],
      experienceYears: 3,
      jobType: JobType.FULL_TIME,
      companyId: COMPANY_ID,
      sort: JobSearchSort.SALARY_DESC,
      limit: 25,
    });
    const encoded = service.encode(
      scopedQuery,
      cursorState([35_000_000, PUBLISHED_AT, JOB_ID, 17]),
    );
    const variants: JobSearchQueryDto[] = [
      query({ ...scopedQuery, q: 'Kỹ sư phần mềm' }),
      query({ ...scopedQuery, location: 'Đà Nẵng' }),
      query({ ...scopedQuery, salaryMin: 11_000_000 }),
      query({ ...scopedQuery, salaryMax: 49_000_000 }),
      query({ ...scopedQuery, skills: ['NestJS'] }),
      query({ ...scopedQuery, experienceYears: 4 }),
      query({ ...scopedQuery, jobType: JobType.REMOTE }),
      query({ ...scopedQuery, companyId: OTHER_COMPANY_ID }),
      query({ ...scopedQuery, sort: JobSearchSort.NEWEST }),
      query({ ...scopedQuery, limit: 24 }),
    ];

    for (const variant of variants) {
      expect(() => service.decode(encoded, variant)).toThrow(
        expect.objectContaining({
          code: 'JOB_SEARCH_CURSOR_SCOPE_MISMATCH',
        }),
      );
    }
  });

  it('binds pagination to the scope and accepts only CURSOR mode', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const state = cursorState([PUBLISHED_AT, JOB_ID, 1]);
    const encoded = service.encode(scopedQuery, state);
    const offsetQuery = query({
      sort: JobSearchSort.NEWEST,
      pagination: JobSearchPaginationMode.OFFSET,
    });

    expectInvalid(() => service.encode(offsetQuery, state));
    expectInvalid(() => service.decode(encoded, offsetQuery));
    expectInvalid(() => service.decode(undefined, offsetQuery));
  });

  it('keeps an absolute expiry and reports the cursor stale at the boundary', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const state = cursorState([PUBLISHED_AT, JOB_ID, 1]);
    const encoded = service.encode(scopedQuery, state);

    jest.setSystemTime(EXPIRES_AT - 1);
    expect(service.decode(encoded, scopedQuery)).toEqual(state);

    jest.setSystemTime(EXPIRES_AT);
    expectStale(() => service.decode(encoded, scopedQuery));
  });

  it.each([
    { label: 'past', expiresAt: NOW - 1 },
    { label: 'equal to now', expiresAt: NOW },
    {
      label: 'beyond the five-minute TTL',
      expiresAt: NOW + JOB_SEARCH_CURSOR_TTL_MS + 1,
    },
  ])('rejects an encode expiry that is $label', ({ expiresAt }) => {
    expectInvalid(() => service.encode(
      query({ sort: JobSearchSort.NEWEST }),
      cursorState(
        [PUBLISHED_AT, JOB_ID, 1],
        { expiresAt },
      ),
    ));
  });

  it('reports a validly signed expired cursor as stale with HTTP 409', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const payload = payloadOf(service.encode(
      scopedQuery,
      cursorState([PUBLISHED_AT, JOB_ID, 1]),
    ));

    expectStale(() => service.decode(
      signPayload({ ...payload, x: NOW - 1 }, KEY),
      scopedQuery,
    ));
  });

  it('rejects a validly signed cursor whose expiry exceeds the TTL', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const payload = payloadOf(service.encode(
      scopedQuery,
      cursorState([PUBLISHED_AT, JOB_ID, 1]),
    ));

    expectInvalid(() => service.decode(
      signPayload({
        ...payload,
        x: NOW + JOB_SEARCH_CURSOR_TTL_MS + 1,
      }, KEY),
      scopedQuery,
    ));
  });

  it('accepts the largest logical page whose offset and successor are safe', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const state = cursorState(
      [PUBLISHED_AT, JOB_ID, 1],
      { page: JOB_SEARCH_CURSOR_MAX_PAGE },
    );

    expect(Number.isSafeInteger(JOB_SEARCH_CURSOR_MAX_PAGE * 50)).toBe(true);
    expect(Number.isSafeInteger(JOB_SEARCH_CURSOR_MAX_PAGE + 1)).toBe(true);
    expect(service.decode(service.encode(scopedQuery, state), scopedQuery))
      .toEqual(state);
  });

  it('rejects a logical page whose multiplied offset is unsafe', () => {
    expectInvalid(() => service.encode(
      query({ sort: JobSearchSort.NEWEST }),
      cursorState(
        [PUBLISHED_AT, JOB_ID, 1],
        { page: JOB_SEARCH_CURSOR_MAX_PAGE + 1 },
      ),
    ));
  });

  it('canonicalizes Unicode, UUID case and set-like skill ordering in scope', () => {
    const decomposed = 'Ky\u0303 su\u031b du\u031b\u0303 lie\u0323\u0302u';
    const original = query({
      q: decomposed,
      skills: ['PostgreSQL', 'NestJS', 'NestJS'],
      companyId: COMPANY_ID.toUpperCase(),
      sort: JobSearchSort.NEWEST,
    });
    const encoded = service.encode(
      original,
      cursorState([PUBLISHED_AT, JOB_ID, 8]),
    );
    const equivalent = query({
      q: decomposed.normalize('NFKC'),
      skills: ['NestJS', 'PostgreSQL'],
      companyId: COMPANY_ID,
      sort: JobSearchSort.NEWEST,
      page: 999,
    });

    expect(service.decode(encoded, equivalent)).toEqual(
      cursorState([PUBLISHED_AT, JOB_ID, 8]),
    );
  });

  it('stores only a canonical scope hash rather than raw search filters', () => {
    const encoded = service.encode(
      query({ q: 'private search text', location: 'private location' }),
      cursorState([5.25, PUBLISHED_AT, JOB_ID, 1]),
    );
    const payload = payloadOf(encoded);

    expect(payload).toMatchObject({
      v: 1,
      s: expect.stringMatching(/^[0-9a-f]{64}$/),
      e: '2026-08-29',
      p: 2,
      t: 100,
      x: EXPIRES_AT,
      i: PIT_ID,
      a: [5.25, PUBLISHED_AT, JOB_ID, 1],
    });
    expect(JSON.stringify(payload)).not.toContain('private search text');
    expect(JSON.stringify(payload)).not.toContain('private location');
  });

  it('rejects body, signature, key and base64url tampering', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const encoded = service.encode(
      scopedQuery,
      cursorState([PUBLISHED_AT, JOB_ID, 1]),
    );
    const [body, signature] = encoded.split('.');
    const changedBody = changeLastCharacter(body);
    const changedSignature = changeLastCharacter(signature);
    const otherKeyCursor = createService(OTHER_KEY).encode(
      scopedQuery,
      cursorState([PUBLISHED_AT, JOB_ID, 1]),
    );

    expectInvalid(() => service.decode(`${changedBody}.${signature}`, scopedQuery));
    expectInvalid(() => service.decode(`${body}.${changedSignature}`, scopedQuery));
    expectInvalid(() => service.decode(`${body}.${signature}=`, scopedQuery));
    expectInvalid(() => service.decode(`${body}+.${signature}`, scopedQuery));
    expectInvalid(() => service.decode(otherKeyCursor, scopedQuery));
  });

  it.each([
    '',
    'one-part',
    'first.second.third',
    'a.',
    '.abc',
    'a'.repeat(JOB_SEARCH_MAX_CURSOR_LENGTH + 1),
  ])('rejects malformed or oversized encoding %j', (encoded) => {
    expectInvalid(() => service.decode(encoded, query()));
  });

  it.each([
    {
      label: 'wrong version',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, v: 2 }),
    },
    {
      label: 'extra key',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, z: true }),
    },
    {
      label: 'missing expiry',
      mutate: (payload: Record<string, unknown>) => {
        const copy = { ...payload };
        delete copy.x;
        return copy;
      },
    },
    {
      label: 'string expiry',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        x: String(EXPIRES_AT),
      }),
    },
    {
      label: 'fractional expiry',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        x: EXPIRES_AT + 0.5,
      }),
    },
    {
      label: 'negative expiry',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, x: -1 }),
    },
    {
      label: 'wrong hash format',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, s: 'A'.repeat(64) }),
    },
    {
      label: 'invalid eligibility date',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, e: '2026-02-29' }),
    },
    {
      label: 'zero page',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, p: 0 }),
    },
    {
      label: 'fractional page',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, p: 1.5 }),
    },
    {
      label: 'missing total',
      mutate: (payload: Record<string, unknown>) => {
        const copy = { ...payload };
        delete copy.t;
        return copy;
      },
    },
    {
      label: 'negative total',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, t: -1 }),
    },
    {
      label: 'fractional total',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, t: 1.5 }),
    },
    {
      label: 'unsafe page',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        p: Number.MAX_SAFE_INTEGER + 1,
      }),
    },
    {
      label: 'page with an unsafe multiplied offset',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        p: JOB_SEARCH_CURSOR_MAX_PAGE + 1,
      }),
    },
    {
      label: 'empty PIT',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, i: '' }),
    },
    {
      label: 'PIT with a control character',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, i: 'pit\nvalue' }),
    },
    {
      label: 'too-large PIT',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, i: 'p'.repeat(2_049) }),
    },
    {
      label: 'non-array search_after',
      mutate: (payload: Record<string, unknown>) => ({ ...payload, a: 'not-array' }),
    },
    {
      label: 'uppercase job UUID',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        a: [PUBLISHED_AT, JOB_ID.toUpperCase(), 1],
      }),
    },
    {
      label: 'non-v4 job UUID',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        a: [PUBLISHED_AT, '11111111-1111-5111-8111-111111111111', 1],
      }),
    },
    {
      label: 'negative shard document',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        a: [PUBLISHED_AT, JOB_ID, -1],
      }),
    },
    {
      label: 'fractional shard document',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        a: [PUBLISHED_AT, JOB_ID, 1.5],
      }),
    },
    {
      label: 'invalid published date sort value',
      mutate: (payload: Record<string, unknown>) => ({
        ...payload,
        a: ['2026-08-29', JOB_ID, 1],
      }),
    },
  ])('rejects a validly signed $label payload', ({ mutate }) => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const valid = payloadOf(service.encode(
      scopedQuery,
      cursorState([PUBLISHED_AT, JOB_ID, 1]),
    ));
    expectInvalid(() =>
      service.decode(signPayload(mutate(valid), KEY), scopedQuery),
    );
  });

  it('rejects validly signed noncanonical JSON key ordering', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const payload = payloadOf(service.encode(
      scopedQuery,
      cursorState([PUBLISHED_AT, JOB_ID, 1]),
    ));
    const reordered = {
      s: payload.s,
      v: payload.v,
      e: payload.e,
      p: payload.p,
      x: payload.x,
      i: payload.i,
      a: payload.a,
    };

    expectInvalid(() =>
      service.decode(signPayload(reordered, KEY), scopedQuery),
    );
  });

  it.each([
    {
      label: 'NEWEST tuple with an extra leading value',
      scopedQuery: query({ sort: JobSearchSort.NEWEST }),
      searchAfter: [1, PUBLISHED_AT, JOB_ID, 2],
    },
    {
      label: 'RELEVANCE query without a score',
      scopedQuery: query({ q: 'nestjs', sort: JobSearchSort.RELEVANCE }),
      searchAfter: [PUBLISHED_AT, JOB_ID, 2],
    },
    {
      label: 'RELEVANCE query with a null score',
      scopedQuery: query({ q: 'nestjs', sort: JobSearchSort.RELEVANCE }),
      searchAfter: [null, PUBLISHED_AT, JOB_ID, 2],
    },
    {
      label: 'RELEVANCE query with a missing-double sentinel score',
      scopedQuery: query({ q: 'nestjs', sort: JobSearchSort.RELEVANCE }),
      searchAfter: ['-Infinity', PUBLISHED_AT, JOB_ID, 2],
    },
    {
      label: 'SALARY tuple without a salary value',
      scopedQuery: query({ sort: JobSearchSort.SALARY_DESC }),
      searchAfter: [PUBLISHED_AT, JOB_ID, 2],
    },
    {
      label: 'SALARY tuple with a negative salary value',
      scopedQuery: query({ sort: JobSearchSort.SALARY_DESC }),
      searchAfter: [-1, PUBLISHED_AT, JOB_ID, 2],
    },
    {
      label: 'SALARY tuple with an arbitrary string sentinel',
      scopedQuery: query({ sort: JobSearchSort.SALARY_DESC }),
      searchAfter: ['Infinity', PUBLISHED_AT, JOB_ID, 2],
    },
  ])('rejects an invalid exact PIT sort tuple: $label', ({
    scopedQuery,
    searchAfter,
  }) => {
    expectInvalid(() =>
      service.encode(scopedQuery, cursorState(searchAfter)),
    );
  });

  it('accepts a canonical ISO timestamp when Elasticsearch formats date sorts', () => {
    const scopedQuery = query({ sort: JobSearchSort.NEWEST });
    const state = cursorState([
      '2026-08-29T01:02:03.004Z',
      JOB_ID,
      5,
    ]);

    expect(service.decode(service.encode(scopedQuery, state), scopedQuery))
      .toEqual(state);
  });

  it.each([
    query({ salaryMin: 2, salaryMax: 1 }),
    query({ q: '' }),
    query({ skills: ['ok', ''] }),
    query({ skills: Array.from({ length: 51 }, (_, index) => `s${index}`) }),
    query({ experienceYears: 61 }),
    query({ companyId: 'not-a-uuid' }),
    query({ sort: 'UNKNOWN' as JobSearchSort }),
    query({ limit: 0 }),
  ])('rejects a noncanonical query defensively', (invalidQuery) => {
    expectInvalid(() =>
      service.encode(
        invalidQuery,
        cursorState([PUBLISHED_AT, JOB_ID, 1]),
      ),
    );
  });

  it.each([
    undefined,
    '',
    'short',
    ' replace-with-a-real-cursor-secret-123456789 ',
    'replace-with-a-real-cursor-secret-123456789',
    'change-me-job-search-cursor-secret-123456789',
    'placeholder-job-search-secret-1234567890123',
    'your-secret-job-search-cursor-value-123456',
    'example-job-search-secret-123456789012345',
    'sample-job-search-secret-1234567890123456',
    'default-job-search-secret-123456789012345',
    'valid-looking-job-search-secret-1234\n',
  ])('fails closed for invalid HMAC configuration: %j', (key) => {
    expect(() => createService(key)).toThrow(
      /JOB_SEARCH_CURSOR_HMAC_KEY.*at least 32 UTF-8 bytes/,
    );
  });

  it('counts the HMAC minimum in UTF-8 bytes', () => {
    expect(() => createService('bí-mật-' + 'á'.repeat(13))).not.toThrow();
  });
});

function query(
  overrides: Partial<JobSearchQueryDto> = {},
): JobSearchQueryDto {
  return {
    page: 1,
    limit: 20,
    sort: JobSearchSort.RELEVANCE,
    pagination: JobSearchPaginationMode.CURSOR,
    ...overrides,
  };
}

function cursorState(
  searchAfter: Array<string | number | null>,
  overrides: Partial<JobSearchCursorState> = {},
): JobSearchCursorState {
  return {
    pitId: PIT_ID,
    searchAfter,
    page: 2,
    total: 100,
    eligibilityDate: '2026-08-29',
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function createService(key: unknown): JobSearchCursorService {
  return new JobSearchCursorService({
    get: jest.fn().mockImplementation((name: string) =>
      name === 'JOB_SEARCH_CURSOR_HMAC_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService);
}

function payloadOf(encoded: string): Record<string, unknown> {
  const [body] = encoded.split('.');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as
    Record<string, unknown>;
}

function signPayload(payload: unknown, key: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', key)
    .update(body, 'utf8')
    .digest('base64url');
  return `${body}.${signature}`;
}

function changeLastCharacter(value: string): string {
  return `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`;
}

function expectInvalid(action: () => unknown): void {
  expect(action).toThrow(
    expect.objectContaining({ code: 'JOB_SEARCH_CURSOR_INVALID' }),
  );
}

function expectStale(action: () => unknown): void {
  try {
    action();
    throw new Error('Expected a stale cursor exception');
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({
      code: 'JOB_SEARCH_CURSOR_STALE',
    }));
    expect((error as { getStatus: () => number }).getStatus()).toBe(409);
  }
}
