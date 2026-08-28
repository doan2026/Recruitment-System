import { ConfigService } from '@nestjs/config';

export const RECOMMENDATION_RESPONSE_MAX_BYTES = 65_536;
export const RECOMMENDATION_TIMEOUT_DEFAULT_MS = 2_000;
const RECOMMENDATION_TIMEOUT_MIN_MS = 100;
const RECOMMENDATION_TIMEOUT_MAX_MS = 10_000;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;

export class RecommendationResponseError extends Error {
  constructor() {
    super('RECOMMENDATION_RESPONSE_INVALID');
    this.name = 'RecommendationResponseError';
  }
}

export async function readBoundedJson(response: Response): Promise<unknown> {
  if (!JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => undefined);
    throw new RecommendationResponseError();
  }
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(contentLength) ||
      Number(contentLength) > RECOMMENDATION_RESPONSE_MAX_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new RecommendationResponseError();
  }
  if (!response.body) throw new RecommendationResponseError();

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > RECOMMENDATION_RESPONSE_MAX_BYTES) {
        throw new RecommendationResponseError();
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof RecommendationResponseError) throw error;
    throw new RecommendationResponseError();
  }
  if (byteLength === 0) throw new RecommendationResponseError();

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new RecommendationResponseError();
  }
}

export function configuredTimeout(
  config: ConfigService,
  key: 'PROFILE_REQUEST_TIMEOUT_MS' | 'AI_REQUEST_TIMEOUT_MS',
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw.trim() === '') {
    return RECOMMENDATION_TIMEOUT_DEFAULT_MS;
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < RECOMMENDATION_TIMEOUT_MIN_MS ||
    value > RECOMMENDATION_TIMEOUT_MAX_MS
  ) {
    throw new Error(
      `${key} must be an integer between ` +
      `${RECOMMENDATION_TIMEOUT_MIN_MS} and ${RECOMMENDATION_TIMEOUT_MAX_MS}`,
    );
  }
  return value;
}

export function configuredServiceUrl(
  config: ConfigService,
  key: 'PROFILE_SERVICE_URL' | 'AI_SERVICE_URL',
  allowedHostsKey:
    | 'PROFILE_SERVICE_ALLOWED_HOSTS'
    | 'AI_SERVICE_ALLOWED_HOSTS',
  fallback: string,
): string {
  const raw = config.get<string>(key)?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} must be an absolute root HTTP URL`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(`${key} must be an absolute root HTTP URL`);
  }

  const fallbackHost = new URL(fallback).hostname.toLowerCase();
  const configuredAllowedHosts = config.get<string>(allowedHostsKey);
  const allowedHostValues = (configuredAllowedHosts === undefined
    ? fallbackHost
    : configuredAllowedHosts
  ).split(',').map((value) => value.trim().toLowerCase());
  if (
    allowedHostValues.length === 0 ||
    allowedHostValues.some((value) => !isNormalizedHostname(value))
  ) {
    throw new Error(
      `${allowedHostsKey} must contain comma-separated normalized hosts`,
    );
  }
  if (!new Set(allowedHostValues).has(url.hostname.toLowerCase())) {
    throw new Error(`${key} host is not allowed by ${allowedHostsKey}`);
  }
  return url.origin;
}

function isNormalizedHostname(value: string): boolean {
  if (!value || value.length > 253 || value.includes(':')) return false;
  try {
    const parsed = new URL(`http://${value}`);
    return parsed.hostname.toLowerCase() === value &&
      parsed.port === '' &&
      parsed.pathname === '/' &&
      !parsed.username &&
      !parsed.password;
  } catch {
    return false;
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
