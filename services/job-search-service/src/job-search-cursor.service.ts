import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobType } from '@prisma/client';
import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'crypto';
import { ApiException } from './common';
import {
  JobSearchPaginationMode,
  JobSearchQueryDto,
  JobSearchSort,
} from './job-search.dto';

export const JOB_SEARCH_MAX_CURSOR_LENGTH = 4_096;
export const JOB_SEARCH_CURSOR_TTL_MS = 5 * 60 * 1_000;
export const JOB_SEARCH_CURSOR_MAX_PAGE = Math.floor(
  Number.MAX_SAFE_INTEGER / 50,
);

export type JobSearchAfterValue = string | number | null;

export interface JobSearchCursorState {
  pitId: string;
  searchAfter: JobSearchAfterValue[];
  page: number;
  total: number;
  eligibilityDate: string;
  expiresAt: number;
}

export type JobSearchCursor = JobSearchCursorState;

interface JobSearchCursorPayload {
  v: 1;
  s: string;
  e: string;
  p: number;
  t: number;
  x: number;
  i: string;
  a: JobSearchAfterValue[];
}

interface CanonicalJobSearchScope {
  q: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  skills: string[];
  experienceYears: number | null;
  jobType: JobType | null;
  companyId: string | null;
  sort: JobSearchSort;
  limit: number;
  pagination: JobSearchPaginationMode.CURSOR;
}

const CURSOR_VERSION = 1;
const ELASTICSEARCH_MISSING_DOUBLE_DESC = '-Infinity';
const CURSOR_KEY_NAME = 'JOB_SEARCH_CURSOR_HMAC_KEY';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDER_PATTERN =
  /(replace[-_ ]?with|change[-_ ]?me|changeme|placeholder|your[-_ ]?(key|secret)|example|sample|default|secret[-_ ]?here|todo)/i;
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]/u;

@Injectable()
export class JobSearchCursorService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = this.readKey(config);
  }

  encode(
    query: JobSearchQueryDto,
    state: JobSearchCursorState,
  ): string {
    const scope = canonicalScope(query);
    const now = Date.now();
    if (!isCursorState(state, scope, now)) throw invalidCursor();

    const payload: JobSearchCursorPayload = {
      v: CURSOR_VERSION,
      s: hashScope(scope),
      e: state.eligibilityDate,
      p: state.page,
      t: state.total,
      x: state.expiresAt,
      i: state.pitId,
      a: [...state.searchAfter],
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const encoded = `${body}.${this.sign(body)}`;
    if (encoded.length > JOB_SEARCH_MAX_CURSOR_LENGTH) {
      throw invalidCursor();
    }
    return encoded;
  }

  decode(
    encoded: string | undefined,
    query: JobSearchQueryDto,
  ): JobSearchCursorState | null {
    const scope = canonicalScope(query);
    if (encoded === undefined) return null;
    if (
      encoded.length < 1 ||
      encoded.length > JOB_SEARCH_MAX_CURSOR_LENGTH
    ) {
      throw invalidCursor();
    }

    const parts = encoded.split('.');
    if (
      parts.length !== 2 ||
      !BASE64URL_PATTERN.test(parts[0]) ||
      !SIGNATURE_PATTERN.test(parts[1])
    ) {
      throw invalidCursor();
    }

    const expected = Buffer.from(this.sign(parts[0]), 'base64url');
    const actual = decodeCanonicalBase64Url(parts[1]);
    if (
      actual === null ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw invalidCursor();
    }

    const decodedBody = decodeCanonicalBase64Url(parts[0]);
    if (decodedBody === null) throw invalidCursor();

    let payload: unknown;
    try {
      payload = JSON.parse(decodedBody.toString('utf8')) as unknown;
    } catch {
      throw invalidCursor();
    }
    if (!isCursorPayload(payload)) throw invalidCursor();

    const canonicalBody = Buffer.from(
      JSON.stringify(toCanonicalPayload(payload)),
      'utf8',
    ).toString('base64url');
    if (canonicalBody !== parts[0]) throw invalidCursor();

    const now = Date.now();
    if (payload.x <= now) throw staleCursor();
    if (payload.x > now + JOB_SEARCH_CURSOR_TTL_MS) throw invalidCursor();

    if (payload.s !== hashScope(scope)) {
      throw new ApiException(
        'JOB_SEARCH_CURSOR_SCOPE_MISMATCH',
        'Job search cursor does not match this query, filters, sort, or limit',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!isSearchAfterForScope(payload.a, scope)) throw invalidCursor();

    return {
      pitId: payload.i,
      searchAfter: [...payload.a],
      page: payload.p,
      total: payload.t,
      eligibilityDate: payload.e,
      expiresAt: payload.x,
    };
  }

  private sign(value: string): string {
    return createHmac('sha256', this.key)
      .update(value, 'utf8')
      .digest('base64url');
  }

  private readKey(config: ConfigService): Buffer {
    const raw = config.get<unknown>(CURSOR_KEY_NAME);
    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.trim() !== raw ||
      CONTROL_OR_FORMAT_PATTERN.test(raw) ||
      Buffer.byteLength(raw, 'utf8') < 32 ||
      PLACEHOLDER_PATTERN.test(raw)
    ) {
      throw new Error(
        `${CURSOR_KEY_NAME} must be a non-placeholder secret of at least 32 UTF-8 bytes`,
      );
    }
    return Buffer.from(raw, 'utf8');
  }
}

const canonicalScope = (
  query: JobSearchQueryDto,
): CanonicalJobSearchScope => {
  if (typeof query !== 'object' || query === null) throw invalidCursor();

  const q = canonicalOptionalText(query.q, 200);
  const location = canonicalOptionalText(query.location, 255);
  const salaryMin = canonicalOptionalNumber(query.salaryMin);
  const salaryMax = canonicalOptionalNumber(query.salaryMax);
  if (
    salaryMin !== null &&
    salaryMax !== null &&
    salaryMin > salaryMax
  ) {
    throw invalidCursor();
  }

  const experienceYears = query.experienceYears === undefined
    ? null
    : query.experienceYears;
  if (
    experienceYears !== null &&
    (!Number.isInteger(experienceYears) ||
      experienceYears < 0 ||
      experienceYears > 60)
  ) {
    throw invalidCursor();
  }

  const jobType = query.jobType === undefined ? null : query.jobType;
  if (
    jobType !== null &&
    !Object.values(JobType).includes(jobType)
  ) {
    throw invalidCursor();
  }

  const companyId = query.companyId === undefined
    ? null
    : canonicalCompanyId(query.companyId);
  const sort = query.sort ?? JobSearchSort.RELEVANCE;
  if (!Object.values(JobSearchSort).includes(sort)) throw invalidCursor();

  const pagination = query.pagination ?? JobSearchPaginationMode.OFFSET;
  if (pagination !== JobSearchPaginationMode.CURSOR) throw invalidCursor();

  const limit = query.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw invalidCursor();
  }

  return {
    q,
    location,
    salaryMin,
    salaryMax,
    skills: canonicalSkills(query.skills),
    experienceYears,
    jobType,
    companyId,
    sort,
    limit,
    pagination,
  };
};

const canonicalOptionalText = (
  value: unknown,
  maxLength: number,
): string | null => {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw invalidCursor();
  const canonical = value.normalize('NFKC').trim();
  if (canonical.length < 1 || canonical.length > maxLength) {
    throw invalidCursor();
  }
  return canonical;
};

const canonicalOptionalNumber = (value: unknown): number | null => {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalidCursor();
  }
  return Object.is(value, -0) ? 0 : value;
};

const canonicalSkills = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw invalidCursor();
  const canonical = value.map((skill) => {
    if (typeof skill !== 'string') throw invalidCursor();
    const normalized = skill.normalize('NFKC').trim();
    if (normalized.length < 1) throw invalidCursor();
    return normalized;
  });
  return [...new Set(canonical)].sort();
};

const canonicalCompanyId = (value: unknown): string => {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw invalidCursor();
  }
  return value.toLowerCase();
};

const hashScope = (scope: CanonicalJobSearchScope): string =>
  createHash('sha256')
    .update(JSON.stringify(scope), 'utf8')
    .digest('hex');

const isCursorState = (
  value: unknown,
  scope: CanonicalJobSearchScope,
  now: number,
): value is JobSearchCursorState => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return isPitId(state.pitId) &&
    isLogicalPage(state.page) &&
    isSearchTotal(state.total) &&
    isCanonicalUtcDate(state.eligibilityDate) &&
    isFutureExpiration(state.expiresAt, now) &&
    Array.isArray(state.searchAfter) &&
    isSearchAfterForScope(state.searchAfter, scope);
};

const isCursorPayload = (
  value: unknown,
): value is JobSearchCursorPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 8 &&
    keys.every((key) => ['v', 's', 'e', 'p', 't', 'x', 'i', 'a'].includes(key)) &&
    record.v === CURSOR_VERSION &&
    typeof record.s === 'string' &&
    SHA256_PATTERN.test(record.s) &&
    isCanonicalUtcDate(record.e) &&
    isLogicalPage(record.p) &&
    isSearchTotal(record.t) &&
    isEpochMilliseconds(record.x) &&
    isPitId(record.i) &&
    isGenericSearchAfter(record.a);
};

const toCanonicalPayload = (
  payload: JobSearchCursorPayload,
): JobSearchCursorPayload => ({
  v: CURSOR_VERSION,
  s: payload.s,
  e: payload.e,
  p: payload.p,
  t: payload.t,
  x: payload.x,
  i: payload.i,
  a: [...payload.a],
});

const isGenericSearchAfter = (
  value: unknown,
): value is JobSearchAfterValue[] => {
  if (!Array.isArray(value) || ![3, 4].includes(value.length)) return false;
  const publishedAt = value[value.length - 3];
  const jobId = value[value.length - 2];
  const shardDoc = value[value.length - 1];
  return isNullableDateSortValue(publishedAt) &&
    typeof jobId === 'string' &&
    CANONICAL_UUID_V4_PATTERN.test(jobId) &&
    isShardDoc(shardDoc) &&
    (value.length === 3 || isSalaryOrScoreSortValue(value[0]));
};

const isSearchAfterForScope = (
  value: unknown,
  scope: CanonicalJobSearchScope,
): value is JobSearchAfterValue[] => {
  if (!isGenericSearchAfter(value)) return false;
  if (scope.sort === JobSearchSort.SALARY_DESC) {
    return value.length === 4 && isSalarySortValue(value[0]);
  }
  if (scope.sort === JobSearchSort.RELEVANCE && scope.q !== null) {
    return value.length === 4 && isNonNegativeNumber(value[0]);
  }
  return value.length === 3;
};

const isNullableDateSortValue = (
  value: unknown,
): value is string | number | null => {
  if (value === null) return true;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return true;
  }
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
};

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isNullableNonNegativeNumber = (
  value: unknown,
): value is number | null => value === null || isNonNegativeNumber(value);

const isSalarySortValue = (
  value: unknown,
): value is number | string | null =>
  isNullableNonNegativeNumber(value) ||
  value === ELASTICSEARCH_MISSING_DOUBLE_DESC;

const isSalaryOrScoreSortValue = isSalarySortValue;

const isShardDoc = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isLogicalPage = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= JOB_SEARCH_CURSOR_MAX_PAGE &&
  Number.isSafeInteger(value * 50) &&
  Number.isSafeInteger(value + 1);

const isEpochMilliseconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isSearchTotal = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isFutureExpiration = (value: unknown, now: number): value is number =>
  isEpochMilliseconds(value) &&
  value > now &&
  value <= now + JOB_SEARCH_CURSOR_TTL_MS;

const isPitId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  Buffer.byteLength(value, 'utf8') <= 2_048 &&
  value.trim() === value &&
  !CONTROL_OR_FORMAT_PATTERN.test(value);

const isCanonicalUtcDate = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString() === `${value}T00:00:00.000Z`;
};

const decodeCanonicalBase64Url = (value: string): Buffer | null => {
  if (!BASE64URL_PATTERN.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
};

const invalidCursor = (): ApiException =>
  new ApiException(
    'JOB_SEARCH_CURSOR_INVALID',
    'Job search cursor is invalid or has been tampered with',
    HttpStatus.BAD_REQUEST,
  );

const staleCursor = (): ApiException =>
  new ApiException(
    'JOB_SEARCH_CURSOR_STALE',
    'Job search cursor has expired; restart the search',
    HttpStatus.CONFLICT,
  );
