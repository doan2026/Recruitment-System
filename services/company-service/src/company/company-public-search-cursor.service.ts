import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiException } from '../common/errors/api-exception';
import {
  canonicalizePublicCompanySearchQuery,
  COMPANY_PUBLIC_SEARCH_MAX_CURSOR_LENGTH,
  COMPANY_PUBLIC_SEARCH_MAX_LIMIT,
} from './dto/public-company-search.dto';

export interface CompanyPublicSearchCursor {
  normalizedName: string;
  id: string;
}

interface CompanyPublicSearchCursorPayload {
  v: 1;
  q: string | null;
  l: number;
  n: string;
  i: string;
}

const CURSOR_KEY_NAME = 'COMPANY_PUBLIC_CURSOR_HMAC_KEY';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLACEHOLDER_PATTERN =
  /(replace[-_ ]?with|change[-_ ]?me|changeme|placeholder|your[-_ ]?(key|secret)|example)/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const QUERY_CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]/u;

@Injectable()
export class CompanyPublicSearchCursorService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = this.readKey(config);
  }

  encode(
    query: string | null,
    limit: number,
    cursor: CompanyPublicSearchCursor,
  ): string {
    if (
      !isCanonicalQuery(query) ||
      !isValidLimit(limit) ||
      !isCanonicalNormalizedName(cursor.normalizedName) ||
      !isCanonicalUuidV4(cursor.id)
    ) {
      throw invalidCursor();
    }

    const payload: CompanyPublicSearchCursorPayload = {
      v: 1,
      q: query,
      l: limit,
      n: cursor.normalizedName,
      i: cursor.id,
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const encoded = `${body}.${this.sign(body)}`;
    if (encoded.length > COMPANY_PUBLIC_SEARCH_MAX_CURSOR_LENGTH) {
      throw invalidCursor();
    }
    return encoded;
  }

  decode(
    encoded: string | undefined,
    query: string | null,
    limit: number,
  ): CompanyPublicSearchCursor | null {
    if (encoded === undefined) return null;
    if (
      encoded.length < 1 ||
      encoded.length > COMPANY_PUBLIC_SEARCH_MAX_CURSOR_LENGTH ||
      !isCanonicalQuery(query) ||
      !isValidLimit(limit)
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

    const body = decodeCanonicalBase64Url(parts[0]);
    if (body === null) throw invalidCursor();

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8')) as unknown;
    } catch {
      throw invalidCursor();
    }
    if (!isCursorPayload(payload)) throw invalidCursor();

    const canonicalBody = Buffer.from(
      JSON.stringify({
        v: 1,
        q: payload.q,
        l: payload.l,
        n: payload.n,
        i: payload.i,
      } satisfies CompanyPublicSearchCursorPayload),
      'utf8',
    ).toString('base64url');
    if (canonicalBody !== parts[0]) throw invalidCursor();

    if (payload.q !== query || payload.l !== limit) {
      throw new ApiException(
        'COMPANY_SEARCH_CURSOR_SCOPE_MISMATCH',
        'Company search cursor does not match this query or limit',
        HttpStatus.BAD_REQUEST,
      );
    }

    return { normalizedName: payload.n, id: payload.i };
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
      CONTROL_CHARACTER_PATTERN.test(raw) ||
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

const isCursorPayload = (
  value: unknown,
): value is CompanyPublicSearchCursorPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 5 &&
    keys.every((key) => ['v', 'q', 'l', 'n', 'i'].includes(key)) &&
    record.v === 1 &&
    isCanonicalQuery(record.q) &&
    isValidLimit(record.l) &&
    isCanonicalNormalizedName(record.n) &&
    isCanonicalUuidV4(record.i)
  );
};

const isCanonicalQuery = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 100 &&
    !QUERY_CONTROL_OR_FORMAT_PATTERN.test(value) &&
    canonicalizePublicCompanySearchQuery(value) === value);

const isValidLimit = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= COMPANY_PUBLIC_SEARCH_MAX_LIMIT;

const isCanonicalNormalizedName = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length < 2 || value.length > 160) {
    return false;
  }
  const canonical = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi');
  return canonical === value;
};

const isCanonicalUuidV4 = (value: unknown): value is string =>
  typeof value === 'string' && CANONICAL_UUID_V4_PATTERN.test(value);

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
    'COMPANY_SEARCH_CURSOR_INVALID',
    'Company search cursor is invalid or has been tampered with',
    HttpStatus.BAD_REQUEST,
  );
