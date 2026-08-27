import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiException } from '../common/http/api-exception';
import {
  ApplicationCvUsage,
  ApplicationCvUsageClient,
} from './application-cv-usage.client';

const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MIN_REQUEST_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 10_000;
const MAX_JSON_RESPONSE_BYTES = 16 * 1024;
const PROFILE_SERVICE_NAME = 'profile-service';
const LOOKUP_PATH = '/internal/v1/cv-usages/lookup';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ENVELOPE_KEYS = ['data', 'meta'] as const;
const USAGE_KEYS = [
  'applicationCount',
  'candidateId',
  'cvId',
  'firstUsedAt',
  'used',
] as const;

type JsonRecord = Record<string, unknown>;

@Injectable()
export class HttpApplicationCvUsageClient
  extends ApplicationCvUsageClient
{
  private readonly baseUrl: string;
  private readonly internalApiKey: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    super();
    this.baseUrl = this.readBaseUrl(config);
    this.internalApiKey = this.readInternalApiKey(
      config,
      'APPLICATION_INTERNAL_API_KEY',
    );
    const inboundApplicationKey = this.readInternalApiKey(
      config,
      'INTERNAL_API_KEY_APPLICATION',
    );
    if (this.sameSecret(this.internalApiKey, inboundApplicationKey)) {
      throw this.configurationError();
    }
    this.requestTimeoutMs = this.readRequestTimeout(config);
  }

  async lookup(
    candidateId: string,
    cvId: string,
  ): Promise<ApplicationCvUsage> {
    if (!UUID_V4_PATTERN.test(candidateId) || !UUID_V4_PATTERN.test(cvId)) {
      throw this.invalidRequest();
    }
    const expectedCandidateId = candidateId.toLowerCase();
    const expectedCvId = cvId.toLowerCase();

    let response: Response;
    try {
      response = await fetch(this.baseUrl + LOOKUP_PATH, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': this.internalApiKey,
          'X-Internal-Service': PROFILE_SERVICE_NAME,
        },
        body: JSON.stringify({
          candidateId: expectedCandidateId,
          cvId: expectedCvId,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw this.unavailable();
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw this.mapUpstreamStatus(response.status);
    }

    const envelope = await this.readJson(response);
    if (
      !this.hasExactKeys(envelope, ENVELOPE_KEYS) ||
      !this.isRecord(envelope.data) ||
      envelope.meta !== null
    ) {
      throw this.badResponse();
    }
    return this.parseUsage(
      envelope.data,
      expectedCandidateId,
      expectedCvId,
    );
  }

  private parseUsage(
    value: JsonRecord,
    expectedCandidateId: string,
    expectedCvId: string,
  ): ApplicationCvUsage {
    if (
      !this.hasExactKeys(value, USAGE_KEYS) ||
      value.candidateId !== expectedCandidateId ||
      value.cvId !== expectedCvId ||
      typeof value.used !== 'boolean' ||
      !Number.isSafeInteger(value.applicationCount) ||
      (value.applicationCount as number) < 0
    ) {
      throw this.badResponse();
    }

    if (value.used) {
      if (
        (value.applicationCount as number) < 1 ||
        !this.isDateTime(value.firstUsedAt)
      ) {
        throw this.badResponse();
      }
    } else if (
      value.applicationCount !== 0 ||
      value.firstUsedAt !== null
    ) {
      throw this.badResponse();
    }

    return value as unknown as ApplicationCvUsage;
  }

  private async readJson(response: Response): Promise<JsonRecord> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw this.badResponse();
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      if (
        !/^\d+$/.test(declaredLength) ||
        Number(declaredLength) > MAX_JSON_RESPONSE_BYTES
      ) {
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
      throw this.unavailable();
    } finally {
      reader.releaseLock();
    }

    let parsed: unknown;
    try {
      const body = Buffer.concat(chunks, totalBytes).toString('utf8');
      parsed = JSON.parse(body) as unknown;
    } catch {
      throw this.badResponse();
    }
    if (!this.isRecord(parsed)) {
      throw this.badResponse();
    }
    return parsed;
  }

  private readBaseUrl(config: ConfigService): string {
    const rawValue = config.get<unknown>('APPLICATION_SERVICE_URL');
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      throw this.configurationError();
    }
    let parsed: URL;
    try {
      parsed = new URL(rawValue.trim());
    } catch {
      throw this.configurationError();
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin === 'null' ||
      parsed.hostname.length === 0 ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw this.configurationError();
    }
    return parsed.origin;
  }

  private readInternalApiKey(
    config: ConfigService,
    environmentName: string,
  ): string {
    const rawValue = config.get<unknown>(environmentName);
    if (typeof rawValue !== 'string') {
      throw this.configurationError();
    }
    const key = rawValue.trim();
    if (
      rawValue !== key ||
      Buffer.byteLength(key, 'utf8') < 32 ||
      key.toLowerCase().includes('replace-with') ||
      /[\u0000-\u001f\u007f]/.test(rawValue)
    ) {
      throw this.configurationError();
    }
    return key;
  }

  private readRequestTimeout(config: ConfigService): number {
    const configured = config.get<unknown>('APPLICATION_REQUEST_TIMEOUT_MS');
    if (configured === undefined) {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    if (typeof configured !== 'string') {
      throw this.configurationError();
    }
    if (configured.trim() === '') {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    const normalized = configured.trim();
    if (!/^\d+$/.test(normalized)) {
      throw this.configurationError();
    }
    const timeout = Number(normalized);
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < MIN_REQUEST_TIMEOUT_MS ||
      timeout > MAX_REQUEST_TIMEOUT_MS
    ) {
      throw this.configurationError();
    }
    return timeout;
  }

  private sameSecret(first: string, second: string): boolean {
    const firstDigest = createHash('sha256').update(first, 'utf8').digest();
    const secondDigest = createHash('sha256').update(second, 'utf8').digest();
    return timingSafeEqual(firstDigest, secondDigest);
  }

  private mapUpstreamStatus(status: number): ApiException {
    if (
      status === HttpStatus.UNAUTHORIZED ||
      status === HttpStatus.FORBIDDEN
    ) {
      return new ApiException(
        'APPLICATION_SERVICE_AUTH_FAILED',
        'Application Service authentication is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      status === HttpStatus.BAD_REQUEST ||
      status === HttpStatus.NOT_FOUND ||
      status === HttpStatus.CONFLICT ||
      status === HttpStatus.UNPROCESSABLE_ENTITY
    ) {
      return new ApiException(
        'APPLICATION_CV_USAGE_INVALID',
        'Application CV usage state is inconsistent',
        HttpStatus.CONFLICT,
      );
    }
    return this.unavailable();
  }

  private hasExactKeys(
    value: JsonRecord,
    expectedKeys: readonly string[],
  ): boolean {
    const actualKeys = Object.keys(value).sort();
    const sortedExpected = [...expectedKeys].sort();
    return (
      actualKeys.length === sortedExpected.length &&
      actualKeys.every((key, index) => key === sortedExpected[index])
    );
  }

  private isRecord(value: unknown): value is JsonRecord {
    return (
      typeof value === 'object' && value !== null && !Array.isArray(value)
    );
  }

  private isDateTime(value: unknown): value is string {
    if (
      typeof value !== 'string' ||
      !ISO_UTC_DATE_TIME_PATTERN.test(value)
    ) {
      return false;
    }
    const parsed = new Date(value);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 19) === value.slice(0, 19)
    );
  }

  private invalidRequest(): ApiException {
    return new ApiException(
      'APPLICATION_CV_USAGE_REQUEST_INVALID',
      'The Application CV usage request is invalid',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private unavailable(): ApiException {
    return new ApiException(
      'APPLICATION_SERVICE_UNAVAILABLE',
      'Application Service is unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private badResponse(): ApiException {
    return new ApiException(
      'APPLICATION_SERVICE_BAD_RESPONSE',
      'Application Service returned an invalid response',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private configurationError(): ApiException {
    return new ApiException(
      'APPLICATION_SERVICE_CONFIGURATION_ERROR',
      'Application Service client configuration is invalid',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
