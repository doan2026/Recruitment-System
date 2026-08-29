import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';
import {
  createHash,
  createPublicKey,
  KeyObject,
} from 'crypto';
import { readFileSync } from 'fs';
import { isIP } from 'net';
import { performance } from 'perf_hooks';
import { TextDecoder } from 'util';
import { AuthUser, SystemRole } from './auth.types';

const MAX_TOKEN_BYTES = 8 * 1024;
const MAX_JWKS_BYTES = 32 * 1024;
const MAX_JWKS_KEYS = 16;
const MIN_RSA_BITS = 2048;
const MAX_RSA_BITS = 8192;
const JWKS_PATH = '/auth/.well-known/jwks.json';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const COMPACT_JWT_PATTERN =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const HEADER_FIELDS = ['alg', 'kid', 'typ'] as const;
const JWK_FIELDS = ['alg', 'e', 'kid', 'kty', 'n', 'use'] as const;

interface AccessTokenClaims extends Record<string, unknown> {
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
  iss?: unknown;
  jti?: unknown;
  role?: unknown;
  sub?: unknown;
}

interface JwtHeader extends Record<string, unknown> {
  alg: 'RS256';
  kid: string;
  typ: 'JWT';
}

interface CanonicalJwk extends Record<string, unknown> {
  alg: 'RS256';
  e: string;
  kid: string;
  kty: 'RSA';
  n: string;
  use: 'sig';
}

interface VerificationKey {
  kid: string;
  pem: string;
}

interface JwtConfiguration {
  audience: string;
  cacheTtlMs: number;
  issuer: string;
  jwksUri?: string;
  refreshCooldownMs: number;
  timeoutMs: number;
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super('Access token is invalid or expired');
    this.name = 'InvalidAccessTokenError';
  }
}

export class AuthKeyUnavailableError extends Error {
  constructor() {
    super('Auth signing keys are unavailable');
    this.name = 'AuthKeyUnavailableError';
  }
}

export class AuthConfigurationError extends Error {
  constructor() {
    super('JWT verification is not configured safely');
    this.name = 'AuthConfigurationError';
  }
}

@Injectable()
export class JwtVerifierService implements OnModuleInit {
  private configuration?: JwtConfiguration;
  private staticKey?: VerificationKey;
  private jwksKeys = new Map<string, string>();
  private jwksExpiresAt = 0;
  private jwksRefreshAllowedAt = 0;
  private jwksRefreshPromise?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit(): void {
    this.ensureConfiguration();
  }

  async verify(token: string): Promise<AuthUser> {
    const configuration = this.ensureConfiguration();
    const header = parseTokenHeader(token);
    const key = await this.getVerificationKey(header.kid, configuration);
    const options: JwtVerifyOptions = {
      algorithms: ['RS256'],
      audience: configuration.audience,
      issuer: configuration.issuer,
      secret: key,
    };

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, options);
    } catch (error) {
      if (isJwtVerificationError(error)) {
        throw new InvalidAccessTokenError();
      }
      throw error;
    }

    const now = Math.floor(Date.now() / 1000);
    const role = claims.role;
    if (
      claims.iss !== configuration.issuer ||
      claims.aud !== configuration.audience ||
      !isCanonicalUuidV4(claims.sub) ||
      !isCanonicalUuidV4(claims.jti) ||
      typeof role !== 'string' ||
      !isSystemRole(role) ||
      !isSafeInteger(claims.iat) ||
      !isSafeInteger(claims.exp) ||
      claims.iat > now + 60 ||
      claims.exp <= claims.iat ||
      claims.exp <= now
    ) {
      throw new InvalidAccessTokenError();
    }

    return {
      id: claims.sub,
      systemRole: role,
    };
  }

  private ensureConfiguration(): JwtConfiguration {
    if (this.configuration) {
      return this.configuration;
    }

    const issuer = this.requiredClaimConfiguration('JWT_ISSUER');
    const audience = this.requiredClaimConfiguration('JWT_AUDIENCE');
    const timeoutMs = this.integerConfiguration(
      'JWT_JWKS_TIMEOUT_MS',
      3_000,
      500,
      10_000,
    );
    const cacheTtlMs = this.integerConfiguration(
      'JWT_JWKS_CACHE_TTL_MS',
      300_000,
      1_000,
      3_600_000,
    );
    const refreshCooldownMs = this.integerConfiguration(
      'JWT_JWKS_REFRESH_COOLDOWN_MS',
      10_000,
      1_000,
      60_000,
    );
    if (refreshCooldownMs > cacheTtlMs) {
      throw new AuthConfigurationError();
    }

    const rawJwksUri = this.optionalString('JWT_JWKS_URI');
    const inlinePublicKey = this.optionalString('JWT_PUBLIC_KEY', true);
    const publicKeyPath = this.optionalString('JWT_PUBLIC_KEY_PATH');
    const configuredSources = [
      rawJwksUri,
      inlinePublicKey,
      publicKeyPath,
    ].filter((value) => value !== '').length;
    if (configuredSources !== 1) {
      throw new AuthConfigurationError();
    }

    let jwksUri: string | undefined;
    if (rawJwksUri) {
      jwksUri = this.validateJwksUri(rawJwksUri);
    } else {
      this.getStaticPublicKey(inlinePublicKey, publicKeyPath);
    }

    this.configuration = {
      audience,
      cacheTtlMs,
      issuer,
      jwksUri,
      refreshCooldownMs,
      timeoutMs,
    };
    return this.configuration;
  }

  private async getVerificationKey(
    keyId: string,
    configuration: JwtConfiguration,
  ): Promise<string> {
    if (!configuration.jwksUri) {
      const key = this.getStaticPublicKey();
      if (key.kid !== keyId) {
        throw new InvalidAccessTokenError();
      }
      return key.pem;
    }
    return this.getJwksPublicKey(keyId, configuration);
  }

  private async getJwksPublicKey(
    keyId: string,
    configuration: JwtConfiguration,
  ): Promise<string> {
    const now = performance.now();
    const cacheIsFresh = now < this.jwksExpiresAt;
    const cached = this.jwksKeys.get(keyId);
    if (cacheIsFresh && cached) {
      return cached;
    }

    if (this.jwksRefreshPromise) {
      await this.jwksRefreshPromise;
      return this.publishedJwksKey(keyId);
    }

    if (now < this.jwksRefreshAllowedAt) {
      if (cacheIsFresh) {
        throw new InvalidAccessTokenError();
      }
      throw new AuthKeyUnavailableError();
    }

    this.jwksRefreshAllowedAt = now + configuration.refreshCooldownMs;
    const refresh = this.refreshJwks(configuration);
    this.jwksRefreshPromise = refresh;
    try {
      await refresh;
    } finally {
      if (this.jwksRefreshPromise === refresh) {
        this.jwksRefreshPromise = undefined;
      }
    }
    return this.publishedJwksKey(keyId);
  }

  private async refreshJwks(configuration: JwtConfiguration): Promise<void> {
    const jwksUri = configuration.jwksUri;
    if (!jwksUri) {
      throw new AuthConfigurationError();
    }

    let response: Response;
    try {
      response = await fetch(jwksUri, {
        headers: {
          accept: 'application/json, application/jwk-set+json',
          'accept-encoding': 'identity',
          'cache-control': 'no-store',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(configuration.timeoutMs),
      });
    } catch {
      throw new AuthKeyUnavailableError();
    }

    if (
      response.status !== 200 ||
      !isJwksContentType(response.headers.get('content-type')) ||
      !isIdentityContentEncoding(response.headers.get('content-encoding'))
    ) {
      await cancelResponseBody(response);
      throw new AuthKeyUnavailableError();
    }

    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]{0,4})$/.test(declaredLength) ||
        Number(declaredLength) > MAX_JWKS_BYTES)
    ) {
      await cancelResponseBody(response);
      throw new AuthKeyUnavailableError();
    }

    const body = await readBoundedResponseBody(response);
    let document: unknown;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(body);
      document = JSON.parse(decoded) as unknown;
    } catch {
      throw new AuthKeyUnavailableError();
    }

    const materialized = parseJwks(document);
    this.jwksKeys = materialized;
    this.jwksExpiresAt = performance.now() + configuration.cacheTtlMs;
  }

  private publishedJwksKey(keyId: string): string {
    const key = this.jwksKeys.get(keyId);
    if (!key) {
      throw new InvalidAccessTokenError();
    }
    return key;
  }

  private getStaticPublicKey(
    configuredInline?: string,
    configuredPath?: string,
  ): VerificationKey {
    if (this.staticKey) {
      return this.staticKey;
    }

    const inline =
      configuredInline ?? this.optionalString('JWT_PUBLIC_KEY', true);
    const keyPath =
      configuredPath ?? this.optionalString('JWT_PUBLIC_KEY_PATH');
    let pem: string;
    try {
      pem = inline
        ? inline.replace(/\\n/g, '\n').trim()
        : keyPath
          ? readFileSync(keyPath, 'utf8').trim()
          : '';
    } catch {
      throw new AuthConfigurationError();
    }
    if (!pem || pem.includes('PRIVATE KEY')) {
      throw new AuthConfigurationError();
    }

    try {
      this.staticKey = materializeKeyObject(createPublicKey(pem));
      return this.staticKey;
    } catch {
      throw new AuthConfigurationError();
    }
  }

  private validateJwksUri(rawValue: string): string {
    if (
      !isVisibleAscii(rawValue) ||
      rawValue.includes('%') ||
      rawValue.includes('\\')
    ) {
      throw new AuthConfigurationError();
    }

    let uri: URL;
    try {
      uri = new URL(rawValue);
    } catch {
      throw new AuthConfigurationError();
    }

    const allowInsecure = this.booleanConfiguration(
      'JWT_ALLOW_INSECURE_JWKS',
      false,
    );
    const hosts = this.allowedHostsConfiguration();
    const protocolAllowed =
      uri.protocol === 'https:' ||
      (uri.protocol === 'http:' && allowInsecure);
    const hostname = canonicalHostname(uri.hostname);
    if (
      !protocolAllowed ||
      !hostname ||
      !hosts.has(hostname) ||
      uri.username !== '' ||
      uri.password !== '' ||
      uri.pathname !== JWKS_PATH ||
      uri.search !== '' ||
      uri.hash !== ''
    ) {
      throw new AuthConfigurationError();
    }
    return uri.toString();
  }

  private allowedHostsConfiguration(): ReadonlySet<string> {
    const raw = this.optionalString('JWT_JWKS_ALLOWED_HOSTS');
    if (!raw) {
      throw new AuthConfigurationError();
    }
    const values = raw.split(',').map((value) => value.trim());
    if (
      values.some(
        (value) =>
          !value ||
          value !== value.toLowerCase() ||
          (!HOSTNAME_PATTERN.test(value) && isIP(value) === 0),
      )
    ) {
      throw new AuthConfigurationError();
    }
    const normalizedValues = values.map((value) => canonicalHostname(value));
    const unique = new Set(normalizedValues);
    if (unique.size !== normalizedValues.length || unique.size > 32) {
      throw new AuthConfigurationError();
    }
    return unique;
  }

  private requiredClaimConfiguration(name: string): string {
    const value = this.optionalString(name);
    if (!value || value.length > 512 || !isVisibleAscii(value)) {
      throw new AuthConfigurationError();
    }
    return value;
  }

  private optionalString(name: string, preserveWhitespace = false): string {
    const raw = this.config.get<unknown>(name);
    if (raw === undefined || raw === null || raw === '') {
      return '';
    }
    if (typeof raw !== 'string') {
      throw new AuthConfigurationError();
    }
    const value = preserveWhitespace ? raw : raw.trim();
    if ((!preserveWhitespace && value !== raw) || value.includes('\0')) {
      throw new AuthConfigurationError();
    }
    return value;
  }

  private booleanConfiguration(name: string, fallback: boolean): boolean {
    const raw = this.config.get<unknown>(name);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
    throw new AuthConfigurationError();
  }

  private integerConfiguration(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const raw = this.config.get<unknown>(name);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    if (
      (typeof raw !== 'string' && typeof raw !== 'number') ||
      (typeof raw === 'string' && !/^(?:0|[1-9][0-9]*)$/.test(raw))
    ) {
      throw new AuthConfigurationError();
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new AuthConfigurationError();
    }
    return value;
  }
}

function parseTokenHeader(token: string): JwtHeader {
  if (
    typeof token !== 'string' ||
    Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES ||
    !COMPACT_JWT_PATTERN.test(token)
  ) {
    throw new InvalidAccessTokenError();
  }

  let value: unknown;
  try {
    const encoded = token.slice(0, token.indexOf('.'));
    const decoded = decodeBase64Url(encoded);
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(decoded),
    ) as unknown;
  } catch {
    throw new InvalidAccessTokenError();
  }
  if (!isExactRecord(value, HEADER_FIELDS)) {
    throw new InvalidAccessTokenError();
  }
  if (
    value.alg !== 'RS256' ||
    value.typ !== 'JWT' ||
    typeof value.kid !== 'string' ||
    value.kid.length > 128 ||
    !BASE64URL_PATTERN.test(value.kid)
  ) {
    throw new InvalidAccessTokenError();
  }
  return value as JwtHeader;
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // The public error remains sanitized even if cancelling the body fails.
  }
}

async function readBoundedResponseBody(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    throw new AuthKeyUnavailableError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > MAX_JWKS_BYTES) {
        throw new AuthKeyUnavailableError();
      }
      chunks.push(result.value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The public error remains sanitized even if cancelling the body fails.
    }
    if (error instanceof AuthKeyUnavailableError) {
      throw error;
    }
    throw new AuthKeyUnavailableError();
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJwks(document: unknown): Map<string, string> {
  if (!isExactRecord(document, ['keys'])) {
    throw new AuthKeyUnavailableError();
  }
  const keys = document.keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_JWKS_KEYS) {
    throw new AuthKeyUnavailableError();
  }

  const result = new Map<string, string>();
  for (const value of keys) {
    if (!isExactRecord(value, JWK_FIELDS)) {
      throw new AuthKeyUnavailableError();
    }
    if (
      value.alg !== 'RS256' ||
      value.kty !== 'RSA' ||
      value.use !== 'sig' ||
      typeof value.kid !== 'string' ||
      typeof value.n !== 'string' ||
      typeof value.e !== 'string' ||
      value.kid.length > 128 ||
      !BASE64URL_PATTERN.test(value.kid) ||
      !BASE64URL_PATTERN.test(value.n) ||
      !BASE64URL_PATTERN.test(value.e) ||
      result.has(value.kid)
    ) {
      throw new AuthKeyUnavailableError();
    }
    const jwk = value as CanonicalJwk;
    try {
      validateRsaNumbers(jwk.n, jwk.e);
      const materialized = materializeJwk(jwk);
      if (materialized.kid !== jwk.kid) {
        throw new Error('thumbprint mismatch');
      }
      result.set(jwk.kid, materialized.pem);
    } catch {
      throw new AuthKeyUnavailableError();
    }
  }
  return result;
}

function materializeJwk(jwk: CanonicalJwk): VerificationKey {
  const key = createPublicKey({
    format: 'jwk',
    key: {
      alg: jwk.alg,
      e: jwk.e,
      ext: true,
      key_ops: ['verify'],
      kid: jwk.kid,
      kty: jwk.kty,
      n: jwk.n,
      use: jwk.use,
    },
  });
  return materializeKeyObject(key);
}

function materializeKeyObject(key: KeyObject): VerificationKey {
  if (
    key.asymmetricKeyType !== 'rsa' ||
    !key.asymmetricKeyDetails ||
    typeof key.asymmetricKeyDetails.modulusLength !== 'number' ||
    key.asymmetricKeyDetails.modulusLength < MIN_RSA_BITS ||
    key.asymmetricKeyDetails.modulusLength > MAX_RSA_BITS
  ) {
    throw new Error('invalid RSA key');
  }
  const jwk = key.export({ format: 'jwk' });
  if (!jwk.n || !jwk.e || jwk.kty !== 'RSA') {
    throw new Error('invalid RSA JWK');
  }
  validateRsaNumbers(jwk.n, jwk.e);
  const kid = jwkThumbprint(jwk.n, jwk.e);
  return {
    kid,
    pem: key
      .export({ format: 'pem', type: 'spki' })
      .toString()
      .trim(),
  };
}

function validateRsaNumbers(modulus: string, exponent: string): void {
  const n = decodeBase64Url(modulus);
  const e = decodeBase64Url(exponent);
  if (
    n.length === 0 ||
    n[0] === 0 ||
    e.length === 0 ||
    e.length > 4 ||
    e[0] === 0
  ) {
    throw new Error('invalid RSA integers');
  }
  const bits = bitLength(n);
  if (
    bits < MIN_RSA_BITS ||
    bits > MAX_RSA_BITS ||
    (n[n.length - 1] & 1) === 0
  ) {
    throw new Error('invalid RSA modulus');
  }
  let exponentValue = 0;
  for (const byte of e) {
    exponentValue = exponentValue * 256 + byte;
  }
  if (
    !Number.isSafeInteger(exponentValue) ||
    exponentValue < 3 ||
    exponentValue > 0xffff_ffff ||
    exponentValue % 2 === 0
  ) {
    throw new Error('invalid RSA exponent');
  }
}

function bitLength(value: Uint8Array): number {
  return (value.length - 1) * 8 + (32 - Math.clz32(value[0]));
}

function jwkThumbprint(modulus: string, exponent: string): string {
  const canonical = JSON.stringify({
    e: exponent,
    kty: 'RSA',
    n: modulus,
  });
  return createHash('sha256').update(canonical, 'ascii').digest('base64url');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || !BASE64URL_PATTERN.test(value)) {
    throw new Error('invalid base64url');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || decoded.toString('base64url') !== value) {
    throw new Error('non-canonical base64url');
  }
  return decoded;
}

function isJwksContentType(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const parts = value.split(';');
  const mediaType = parts[0].trim().toLowerCase();
  if (
    mediaType !== 'application/json' &&
    mediaType !== 'application/jwk-set+json'
  ) {
    return false;
  }
  if (parts.length === 1) {
    return true;
  }
  if (parts.length !== 2) {
    return false;
  }
  const [name, rawCharset] = parts[1].split('=', 2);
  if (!rawCharset || name.trim().toLowerCase() !== 'charset') {
    return false;
  }
  const charset = rawCharset.trim().replace(/^"|"$/g, '').toLowerCase();
  return charset === 'utf-8' || charset === 'utf8';
}

function isIdentityContentEncoding(value: string | null): boolean {
  return value === null || value.trim().toLowerCase() === 'identity';
}

function canonicalHostname(value: string): string {
  const lower = value.toLowerCase();
  if (lower.startsWith('[') && lower.endsWith(']')) {
    return lower.slice(1, -1);
  }
  if (isIP(lower) === 6) {
    const normalized = new URL(`https://[${lower}]/`).hostname.toLowerCase();
    return normalized.slice(1, -1);
  }
  return lower;
}

function isCanonicalUuidV4(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_V4_PATTERN.test(value);
}

function isSystemRole(value: string): value is SystemRole {
  return Object.values(SystemRole).includes(value as SystemRole);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isJwtVerificationError(value: unknown): value is Error {
  return value instanceof Error &&
    ['JsonWebTokenError', 'NotBeforeError', 'TokenExpiredError'].includes(
      value.name,
    );
}

function isExactRecord<const T extends readonly string[]>(
  value: unknown,
  expectedFields: T,
): value is Record<T[number], unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return actual.length === expected.length &&
    actual.every((field, index) => field === expected[index]);
}

function isVisibleAscii(value: string): boolean {
  return value.length > 0 &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e;
    });
}
