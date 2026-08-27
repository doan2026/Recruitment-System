import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/http/api-exception';
import {
  ProfileMediaClient,
  ProfileMediaType,
  UserFileDownloadUrl,
  UserFileReference,
  VerifiedUserFile,
} from './profile-media.client';

const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MIN_REQUEST_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 10_000;
const MAX_JSON_RESPONSE_BYTES = 64 * 1024;
const PROFILE_SERVICE_NAME = 'profile-service';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const REFERENCE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const METADATA_KEYS = [
  'aggregateVersion',
  'bytes',
  'createdAt',
  'format',
  'id',
  'mimeType',
  'originalFilename',
  'ownerId',
  'ownerType',
  'privateDelivery',
  'status',
  'type',
  'updatedAt',
  'url',
] as const;
const REFERENCE_KEYS = [
  'callerService',
  'createdAt',
  'fileId',
  'id',
  'referenceId',
  'referenceType',
] as const;
const DOWNLOAD_KEYS = ['expiresAt', 'url'] as const;
const RELEASE_KEYS = ['released'] as const;
const ENVELOPE_KEYS = ['data', 'meta'] as const;

type JsonRecord = Record<string, unknown>;

@Injectable()
export class HttpProfileMediaClient extends ProfileMediaClient {
  private readonly baseUrl: string;
  private readonly internalApiKey: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    super();
    this.baseUrl = this.readBaseUrl(config);
    this.internalApiKey = this.readInternalApiKey(config);
    this.requestTimeoutMs = this.readRequestTimeout(config);
  }

  async verifyUserFile<T extends ProfileMediaType>(
    fileId: string,
    userId: string,
    type: T,
  ): Promise<Extract<VerifiedUserFile, { type: T }>> {
    this.assertExpectation(fileId, userId, type);
    const canonicalFileId = fileId.toLowerCase();
    const canonicalUserId = userId.toLowerCase();
    const data = await this.request('POST', '/internal/verify', {
      expectedOwnerId: canonicalUserId,
      expectedOwnerType: 'USER',
      expectedType: type,
      fileId: canonicalFileId,
    });
    return this.parseVerifiedFile(
      data,
      canonicalFileId,
      canonicalUserId,
      type,
    ) as Extract<VerifiedUserFile, { type: T }>;
  }

  async bindUserFile(
    fileId: string,
    userId: string,
    type: ProfileMediaType,
    referenceType: string,
    referenceId: string,
  ): Promise<UserFileReference> {
    this.assertExpectation(fileId, userId, type);
    const canonicalFileId = fileId.toLowerCase();
    const canonicalUserId = userId.toLowerCase();
    if (
      !REFERENCE_TYPE_PATTERN.test(referenceType) ||
      !REFERENCE_ID_PATTERN.test(referenceId)
    ) {
      throw this.invalidRequest();
    }
    const data = await this.request('POST', '/internal/references', {
      expectedOwnerId: canonicalUserId,
      expectedOwnerType: 'USER',
      expectedType: type,
      fileId: canonicalFileId,
      referenceId,
      referenceType,
    });
    return this.parseReference(
      data,
      canonicalFileId,
      referenceType,
      referenceId,
    );
  }

  async releaseReference(referenceId: string): Promise<void> {
    if (!UUID_V4_PATTERN.test(referenceId)) {
      throw this.invalidRequest();
    }
    const data = await this.request(
      'DELETE',
      '/internal/references/' +
        encodeURIComponent(referenceId.toLowerCase()),
    );
    if (
      !this.hasExactKeys(data, RELEASE_KEYS) ||
      data.released !== true
    ) {
      throw this.badResponse();
    }
  }

  async createUserDownloadUrl(
    fileId: string,
    userId: string,
    type: ProfileMediaType,
  ): Promise<UserFileDownloadUrl> {
    this.assertExpectation(fileId, userId, type);
    const canonicalFileId = fileId.toLowerCase();
    const canonicalUserId = userId.toLowerCase();
    const data = await this.request('POST', '/internal/download-url', {
      expectedOwnerId: canonicalUserId,
      expectedOwnerType: 'USER',
      expectedType: type,
      fileId: canonicalFileId,
    });
    if (!this.hasExactKeys(data, DOWNLOAD_KEYS)) {
      throw this.badResponse();
    }
    const url = this.parseHttpsUrl(data.url);
    if (
      !this.isDateTime(data.expiresAt) ||
      Date.parse(data.expiresAt) <= Date.now()
    ) {
      throw this.badResponse();
    }
    return { url, expiresAt: data.expiresAt };
  }

  private async request(
    method: 'DELETE' | 'POST',
    path: string,
    payload?: JsonRecord,
  ): Promise<JsonRecord> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': this.internalApiKey,
          'X-Internal-Service': PROFILE_SERVICE_NAME,
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
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
      !(
        envelope.meta === null ||
        this.isRecord(envelope.meta)
      )
    ) {
      throw this.badResponse();
    }
    return envelope.data;
  }

  private async readJson(response: Response): Promise<JsonRecord> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw this.badResponse();
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength)) {
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

  private parseVerifiedFile(
    data: JsonRecord,
    expectedFileId: string,
    expectedUserId: string,
    expectedType: ProfileMediaType,
  ): VerifiedUserFile {
    if (
      !this.hasExactKeys(data, METADATA_KEYS) ||
      data.id !== expectedFileId ||
      data.ownerType !== 'USER' ||
      data.ownerId !== expectedUserId ||
      data.type !== expectedType ||
      data.status !== 'ACTIVE' ||
      typeof data.originalFilename !== 'string' ||
      data.originalFilename.length === 0 ||
      !this.isNullableNonEmptyString(data.mimeType) ||
      !this.isNullableNonEmptyString(data.format) ||
      !this.isNullableNonNegativeInteger(data.bytes) ||
      !Number.isInteger(data.aggregateVersion) ||
      (data.aggregateVersion as number) < 1 ||
      !this.isDateTime(data.createdAt) ||
      !this.isDateTime(data.updatedAt)
    ) {
      throw this.badResponse();
    }

    if (expectedType === 'AVATAR') {
      if (
        data.privateDelivery !== false ||
        typeof data.url !== 'string'
      ) {
        throw this.badResponse();
      }
      this.parseHttpsUrl(data.url);
    } else if (
      data.privateDelivery !== true ||
      data.url !== null
    ) {
      throw this.badResponse();
    }
    return data as unknown as VerifiedUserFile;
  }

  private parseReference(
    data: JsonRecord,
    expectedFileId: string,
    expectedReferenceType: string,
    expectedReferenceId: string,
  ): UserFileReference {
    if (
      !this.hasExactKeys(data, REFERENCE_KEYS) ||
      !UUID_V4_PATTERN.test(String(data.id ?? '')) ||
      data.fileId !== expectedFileId ||
      data.callerService !== PROFILE_SERVICE_NAME ||
      data.referenceType !== expectedReferenceType ||
      data.referenceId !== expectedReferenceId ||
      !this.isDateTime(data.createdAt)
    ) {
      throw this.badResponse();
    }
    return data as unknown as UserFileReference;
  }

  private assertExpectation(
    fileId: string,
    userId: string,
    type: ProfileMediaType,
  ): void {
    if (
      !UUID_V4_PATTERN.test(fileId) ||
      !UUID_V4_PATTERN.test(userId) ||
      (type !== 'AVATAR' && type !== 'CV')
    ) {
      throw this.invalidRequest();
    }
  }

  private parseHttpsUrl(value: unknown): string {
    if (typeof value !== 'string') {
      throw this.badResponse();
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw this.badResponse();
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname.length === 0 ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== ''
    ) {
      throw this.badResponse();
    }
    return value;
  }

  private readBaseUrl(config: ConfigService): string {
    const rawValue = config.get<unknown>('MEDIA_SERVICE_URL');
    if (typeof rawValue !== 'string') {
      throw this.configurationError();
    }
    const configured = rawValue.trim();
    if (!configured) {
      throw this.configurationError();
    }
    let parsed: URL;
    try {
      parsed = new URL(configured);
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

  private readInternalApiKey(config: ConfigService): string {
    const rawValue = config.get<unknown>('MEDIA_INTERNAL_API_KEY');
    if (typeof rawValue !== 'string') {
      throw this.configurationError();
    }
    const key = rawValue.trim();
    if (
      Buffer.byteLength(key, 'utf8') < 32 ||
      key.toLowerCase().includes('replace-with') ||
      /[\u0000-\u001f\u007f]/.test(key)
    ) {
      throw this.configurationError();
    }
    return key;
  }

  private readRequestTimeout(config: ConfigService): number {
    const configured = config.get<unknown>('MEDIA_REQUEST_TIMEOUT_MS');
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
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private isNullableNonEmptyString(value: unknown): boolean {
    return value === null || (typeof value === 'string' && value.length > 0);
  }

  private isNullableNonNegativeInteger(value: unknown): boolean {
    return (
      value === null ||
      (Number.isSafeInteger(value) && (value as number) >= 0)
    );
  }

  private isDateTime(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      ISO_UTC_DATE_TIME_PATTERN.test(value) &&
      Number.isFinite(Date.parse(value))
    );
  }

  private mapUpstreamStatus(status: number): ApiException {
    if (status === HttpStatus.UNAUTHORIZED) {
      return new ApiException(
        'MEDIA_SERVICE_AUTH_FAILED',
        'Media Service authentication is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      status === HttpStatus.FORBIDDEN ||
      status === HttpStatus.NOT_FOUND ||
      status === HttpStatus.CONFLICT ||
      status === HttpStatus.GONE ||
      status === HttpStatus.UNPROCESSABLE_ENTITY
    ) {
      return new ApiException(
        'MEDIA_FILE_INVALID',
        'The media file is not valid for the requested operation',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.unavailable();
  }

  private invalidRequest(): ApiException {
    return new ApiException(
      'MEDIA_REQUEST_INVALID',
      'The media request is invalid',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private unavailable(): ApiException {
    return new ApiException(
      'MEDIA_SERVICE_UNAVAILABLE',
      'Media Service is unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private badResponse(): ApiException {
    return new ApiException(
      'MEDIA_SERVICE_BAD_RESPONSE',
      'Media Service returned an invalid response',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private configurationError(): ApiException {
    return new ApiException(
      'MEDIA_SERVICE_CONFIGURATION_ERROR',
      'Media Service client configuration is invalid',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
