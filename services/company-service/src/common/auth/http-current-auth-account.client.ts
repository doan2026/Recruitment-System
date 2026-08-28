import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../errors/api-exception';
import {
  CurrentAuthAccountClient,
  CurrentRecruiterIdentity,
} from './current-auth-account.client';
import { SystemRole } from './system-role.enum';

const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MIN_REQUEST_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 10_000;
const MAX_JSON_RESPONSE_BYTES = 16 * 1024;
const MAX_ACCESS_TOKEN_BYTES = 8192;
const MAX_EMAIL_LENGTH = 320;
const DEFAULT_AUTH_SERVICE_URL = 'http://auth-service:8080';
const DEFAULT_AUTH_SERVICE_ALLOWED_HOSTS = 'auth-service';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMPACT_JWT_PATTERN =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const HOST_PATTERN =
  /^(?:localhost|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/;

const ENVELOPE_KEYS = ['data', 'meta'] as const;
const ACCOUNT_KEYS = ['email', 'id', 'role', 'verified'] as const;

type JsonRecord = Record<string, unknown>;

@Injectable()
export class HttpCurrentAuthAccountClient extends CurrentAuthAccountClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    super();
    this.baseUrl = this.readBaseUrl(config);
    this.requestTimeoutMs = this.readRequestTimeout(config);
  }

  async getCurrentRecruiter(
    accessToken: string,
    expectedUserId: string,
  ): Promise<CurrentRecruiterIdentity> {
    if (
      !UUID_V4_PATTERN.test(expectedUserId) ||
      typeof accessToken !== 'string' ||
      Buffer.byteLength(accessToken, 'utf8') > MAX_ACCESS_TOKEN_BYTES ||
      !COMPACT_JWT_PATTERN.test(accessToken)
    ) {
      throw this.invalidAccount();
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl + '/auth/me', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + accessToken,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw this.unavailable();
    }

    if (response.status !== HttpStatus.OK) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === HttpStatus.UNAUTHORIZED) {
        throw this.invalidAccount();
      }
      if (response.status === HttpStatus.FORBIDDEN) {
        throw this.inactiveAccount();
      }
      throw this.unavailable();
    }

    const envelope = await this.readJson(response);
    if (
      !this.hasExactKeys(envelope, ENVELOPE_KEYS) ||
      !this.isRecord(envelope.data) ||
      !this.isEmptyRecord(envelope.meta)
    ) {
      throw this.badResponse();
    }

    const data = envelope.data;
    if (
      !this.hasExactKeys(data, ACCOUNT_KEYS) ||
      typeof data.id !== 'string' ||
      !UUID_V4_PATTERN.test(data.id) ||
      data.id !== expectedUserId
    ) {
      throw this.badResponse();
    }

    const normalizedEmail = this.readCanonicalEmail(data.email);
    if (
      data.role !== SystemRole.RECRUITER ||
      data.verified !== true
    ) {
      throw this.acceptanceForbidden();
    }

    return { id: data.id, normalizedEmail };
  }

  private async readJson(response: Response): Promise<JsonRecord> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      void response.body?.cancel().catch(() => undefined);
      throw this.badResponse();
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength)) {
        void response.body?.cancel().catch(() => undefined);
        throw this.badResponse();
      }
      if (Number(declaredLength) > MAX_JSON_RESPONSE_BYTES) {
        void response.body?.cancel().catch(() => undefined);
        throw this.badResponse();
      }
    }

    if (!response.body) {
      throw this.badResponse();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        totalBytes += chunk.value.byteLength;
        if (totalBytes > MAX_JSON_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw this.badResponse();
        }
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      await reader.cancel().catch(() => undefined);
      throw this.unavailable();
    } finally {
      reader.releaseLock();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks, totalBytes),
        ),
      ) as unknown;
    } catch {
      throw this.badResponse();
    }
    if (!this.isRecord(parsed)) {
      throw this.badResponse();
    }
    return parsed;
  }

  private readCanonicalEmail(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_EMAIL_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw this.badResponse();
    }
    const normalized = value.trim().normalize('NFC').toLowerCase();
    if (
      normalized !== value ||
      normalized.length === 0 ||
      normalized.length > MAX_EMAIL_LENGTH ||
      !SIMPLE_EMAIL_PATTERN.test(normalized)
    ) {
      throw this.badResponse();
    }
    return normalized;
  }

  private readBaseUrl(config: ConfigService): string {
    const rawUrl =
      config.get<unknown>('AUTH_SERVICE_URL') ??
      DEFAULT_AUTH_SERVICE_URL;
    const rawAllowedHosts =
      config.get<unknown>('AUTH_SERVICE_ALLOWED_HOSTS') ??
      DEFAULT_AUTH_SERVICE_ALLOWED_HOSTS;
    if (
      typeof rawUrl !== 'string' ||
      typeof rawAllowedHosts !== 'string'
    ) {
      throw this.configurationError();
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw this.configurationError();
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin === 'null' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw this.configurationError();
    }

    const allowedHosts = rawAllowedHosts
      .split(',')
      .map((host) => host.trim().toLowerCase());
    if (
      allowedHosts.length === 0 ||
      allowedHosts.some(
        (host) =>
          host.length === 0 ||
          host.length > 253 ||
          !HOST_PATTERN.test(host),
      ) ||
      !allowedHosts.includes(parsed.hostname.toLowerCase())
    ) {
      throw this.configurationError();
    }
    return parsed.origin;
  }

  private readRequestTimeout(config: ConfigService): number {
    const configured = config.get<unknown>('AUTH_REQUEST_TIMEOUT_MS');
    if (configured === undefined || configured === '') {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    if (
      typeof configured !== 'string' ||
      !/^\d+$/.test(configured.trim())
    ) {
      throw this.configurationError();
    }
    const timeout = Number(configured.trim());
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < MIN_REQUEST_TIMEOUT_MS ||
      timeout > MAX_REQUEST_TIMEOUT_MS
    ) {
      throw this.configurationError();
    }
    return timeout;
  }

  private hasExactKeys(
    value: JsonRecord,
    expectedKeys: readonly string[],
  ): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return (
      actual.length === expected.length &&
      actual.every((key, index) => key === expected[index])
    );
  }

  private isRecord(value: unknown): value is JsonRecord {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private isEmptyRecord(value: unknown): boolean {
    return this.isRecord(value) && Object.keys(value).length === 0;
  }

  private invalidAccount(): ApiException {
    return new ApiException(
      'AUTH_ACCOUNT_INVALID',
      'The authenticated account is no longer valid',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private inactiveAccount(): ApiException {
    return new ApiException(
      'AUTH_ACCOUNT_INACTIVE',
      'The authenticated account cannot accept invitations',
      HttpStatus.FORBIDDEN,
    );
  }

  private acceptanceForbidden(): ApiException {
    return new ApiException(
      'INVITATION_ACCEPTANCE_FORBIDDEN',
      'The authenticated account cannot accept invitations',
      HttpStatus.FORBIDDEN,
    );
  }

  private unavailable(): ApiException {
    return new ApiException(
      'AUTH_SERVICE_UNAVAILABLE',
      'Auth Service is unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private badResponse(): ApiException {
    return new ApiException(
      'AUTH_SERVICE_BAD_RESPONSE',
      'Auth Service returned an invalid response',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private configurationError(): ApiException {
    return new ApiException(
      'AUTH_SERVICE_CONFIGURATION_ERROR',
      'Auth Service client configuration is invalid',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
