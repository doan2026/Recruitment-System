import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors/api-exception';
import {
  CompanyFileReference,
  CompanyMediaClient,
  CompanyMediaAssetType,
  CompanyUploadCapability,
  VerifiedCompanyFile,
} from './company-media.client';

const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MIN_REQUEST_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 10_000;
const MAX_JSON_RESPONSE_BYTES = 64 * 1024;
const MAX_UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;
const COMPANY_SERVICE_NAME = 'company-service';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const REFERENCE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SAFE_PROVIDER_VALUE_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

const ENVELOPE_KEYS = ['data', 'meta'] as const;
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
const RELEASE_KEYS = ['released'] as const;
const CAPABILITY_KEYS = [
  'allowedFormats',
  'apiKey',
  'cloudName',
  'expiresAt',
  'fileId',
  'maxBytes',
  'params',
  'resourceType',
  'signature',
  'uploadUrl',
] as const;
const UPLOAD_PARAM_KEYS = [
  'allowed_formats',
  'context',
  'folder',
  'overwrite',
  'public_id',
  'timestamp',
  'type',
  'unique_filename',
  'upload_preset',
  'use_filename',
] as const;

interface CompanyMediaPolicy {
  readonly formats: readonly string[];
  readonly folder: string;
  readonly maxBytes: number;
  readonly resourceType: 'image' | 'video';
}

const COMPANY_MEDIA_POLICIES: Record<
  CompanyMediaAssetType,
  CompanyMediaPolicy
> = {
  [CompanyMediaAssetType.COMPANY_LOGO]: {
    formats: ['jpg', 'png', 'webp'],
    folder: 'recruitment/company-logo',
    maxBytes: 2 * 1024 * 1024,
    resourceType: 'image',
  },
  [CompanyMediaAssetType.COMPANY_IMAGE]: {
    formats: ['jpg', 'png', 'webp'],
    folder: 'recruitment/company-image',
    maxBytes: 5 * 1024 * 1024,
    resourceType: 'image',
  },
  [CompanyMediaAssetType.COMPANY_VIDEO]: {
    formats: ['mp4'],
    folder: 'recruitment/company-video',
    maxBytes: 50 * 1024 * 1024,
    resourceType: 'video',
  },
};

type JsonRecord = Record<string, unknown>;

@Injectable()
export class HttpCompanyMediaClient extends CompanyMediaClient {
  private readonly baseUrl: string;
  private readonly internalApiKey: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    super();
    this.baseUrl = this.readBaseUrl(config);
    this.internalApiKey = this.readInternalApiKey(config);
    this.requestTimeoutMs = this.readRequestTimeout(config);
  }

  async createCompanyUploadIntent(
    companyId: string,
    requestedBy: string,
    assetType: CompanyMediaAssetType,
    originalFilename: string,
    idempotencyKey?: string,
  ): Promise<CompanyUploadCapability> {
    this.assertCompanyIdAndType(companyId, assetType);
    if (!UUID_V4_PATTERN.test(requestedBy)) {
      throw this.invalidRequest();
    }
    const filename = this.normalizeFilename(originalFilename, assetType);
    if (
      idempotencyKey !== undefined &&
      !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    ) {
      throw this.invalidRequest();
    }

    const expectedCompanyId = companyId.toLowerCase();
    const data = await this.request(
      'POST',
      '/internal/signature',
      {
        originalFilename: filename.originalFilename,
        ownerId: expectedCompanyId,
        ownerType: 'COMPANY',
        requestedBy: requestedBy.toLowerCase(),
        type: assetType,
      },
      idempotencyKey,
      'UPLOAD',
    );
    return this.parseUploadCapability(data, assetType, filename.format);
  }

  async confirmCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): Promise<VerifiedCompanyFile> {
    this.assertFileExpectation(fileId, companyId, assetType);
    const expectedFileId = fileId.toLowerCase();
    const expectedCompanyId = companyId.toLowerCase();
    const data = await this.request('POST', '/internal/confirm', {
      fileId: expectedFileId,
    });
    return this.parseActiveFile(
      data,
      expectedFileId,
      expectedCompanyId,
      assetType,
    );
  }

  async verifyCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): Promise<VerifiedCompanyFile> {
    this.assertFileExpectation(fileId, companyId, assetType);
    const expectedFileId = fileId.toLowerCase();
    const expectedCompanyId = companyId.toLowerCase();
    const data = await this.request('POST', '/internal/verify', {
      expectedOwnerId: expectedCompanyId,
      expectedOwnerType: 'COMPANY',
      expectedType: assetType,
      fileId: expectedFileId,
    });
    return this.parseActiveFile(
      data,
      expectedFileId,
      expectedCompanyId,
      assetType,
    );
  }

  async bindCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
    referenceType: string,
    referenceId: string,
  ): Promise<CompanyFileReference> {
    this.assertFileExpectation(fileId, companyId, assetType);
    if (
      !REFERENCE_TYPE_PATTERN.test(referenceType) ||
      !REFERENCE_ID_PATTERN.test(referenceId)
    ) {
      throw this.invalidRequest();
    }
    const expectedFileId = fileId.toLowerCase();
    const data = await this.request('POST', '/internal/references', {
      expectedOwnerId: companyId.toLowerCase(),
      expectedOwnerType: 'COMPANY',
      expectedType: assetType,
      fileId: expectedFileId,
      referenceId,
      referenceType,
    });
    return this.parseReference(
      data,
      expectedFileId,
      referenceType,
      referenceId,
    );
  }

  async releaseReference(mediaReferenceUuid: string): Promise<void> {
    if (!UUID_V4_PATTERN.test(mediaReferenceUuid)) {
      throw this.invalidRequest();
    }
    const data = await this.request(
      'DELETE',
      '/internal/references/' +
        encodeURIComponent(mediaReferenceUuid.toLowerCase()),
    );
    if (!this.hasExactKeys(data, RELEASE_KEYS) || data.released !== true) {
      throw this.badResponse();
    }
  }

  async deleteCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): Promise<void> {
    this.assertFileExpectation(fileId, companyId, assetType);
    const expectedFileId = fileId.toLowerCase();
    const expectedCompanyId = companyId.toLowerCase();
    const data = await this.request(
      'DELETE',
      '/internal/files/' + encodeURIComponent(expectedFileId),
      undefined,
      undefined,
      'DELETE',
    );
    this.parseDeletedFile(
      data,
      expectedFileId,
      expectedCompanyId,
      assetType,
    );
  }

  private async request(
    method: 'DELETE' | 'POST',
    path: string,
    payload?: JsonRecord,
    idempotencyKey?: string,
    purpose: 'DEFAULT' | 'DELETE' | 'UPLOAD' = 'DEFAULT',
  ): Promise<JsonRecord> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Internal-Api-Key': this.internalApiKey,
      'X-Internal-Service': COMPANY_SERVICE_NAME,
    };
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw this.unavailable();
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw this.mapUpstreamStatus(response.status, purpose);
    }

    const envelope = await this.readJson(response);
    if (
      !this.hasExactKeys(envelope, ENVELOPE_KEYS) ||
      !this.isRecord(envelope.data) ||
      envelope.meta !== null
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
      parsed = JSON.parse(
        Buffer.concat(chunks, totalBytes).toString('utf8'),
      ) as unknown;
    } catch {
      throw this.badResponse();
    }
    if (!this.isRecord(parsed)) {
      throw this.badResponse();
    }
    return parsed;
  }

  private parseUploadCapability(
    data: JsonRecord,
    assetType: CompanyMediaAssetType,
    expectedFormat: string,
  ): CompanyUploadCapability {
    const policy = COMPANY_MEDIA_POLICIES[assetType];
    if (
      !this.hasExactKeys(data, CAPABILITY_KEYS) ||
      !UUID_V4_PATTERN.test(String(data.fileId ?? '')) ||
      typeof data.cloudName !== 'string' ||
      !SAFE_PROVIDER_VALUE_PATTERN.test(data.cloudName) ||
      typeof data.apiKey !== 'string' ||
      !SAFE_PROVIDER_VALUE_PATTERN.test(data.apiKey) ||
      data.resourceType !== policy.resourceType ||
      data.maxBytes !== policy.maxBytes ||
      !Array.isArray(data.allowedFormats) ||
      data.allowedFormats.length !== 1 ||
      data.allowedFormats[0] !== expectedFormat ||
      !SHA256_HEX_PATTERN.test(String(data.signature ?? '')) ||
      !this.isRecord(data.params)
    ) {
      throw this.badResponse();
    }

    const expiresAt =
      typeof data.expiresAt === 'string'
        ? Date.parse(data.expiresAt)
        : Number.NaN;
    const now = Date.now();
    if (
      !this.isDateTime(data.expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + MAX_UPLOAD_INTENT_TTL_MS
    ) {
      throw this.badResponse();
    }

    const expectedFileId = (data.fileId as string).toLowerCase();
    const params = data.params;
    if (
      !this.hasExactKeys(params, UPLOAD_PARAM_KEYS) ||
      params.allowed_formats !== expectedFormat ||
      params.context !== 'file_id=' + expectedFileId ||
      params.folder !== policy.folder ||
      params.overwrite !== 'false' ||
      params.public_id !== expectedFileId ||
      !Number.isSafeInteger(params.timestamp) ||
      (params.timestamp as number) <= 0 ||
      params.type !== 'upload' ||
      params.unique_filename !== 'false' ||
      typeof params.upload_preset !== 'string' ||
      !SAFE_PROVIDER_VALUE_PATTERN.test(params.upload_preset) ||
      params.use_filename !== 'false'
    ) {
      throw this.badResponse();
    }

    const expectedUploadUrl =
      'https://api.cloudinary.com/v1_1/' +
      encodeURIComponent(data.cloudName) +
      '/' +
      policy.resourceType +
      '/upload';
    if (data.uploadUrl !== expectedUploadUrl) {
      throw this.badResponse();
    }
    this.parseHttpsUrl(data.uploadUrl);

    return {
      allowedFormats: [expectedFormat],
      apiKey: data.apiKey,
      cloudName: data.cloudName,
      expiresAt: data.expiresAt,
      fileId: expectedFileId,
      maxBytes: data.maxBytes,
      params: data.params as Record<string, string | number>,
      resourceType: policy.resourceType,
      signature: data.signature as string,
      uploadUrl: data.uploadUrl,
    };
  }

  private parseActiveFile(
    data: JsonRecord,
    expectedFileId: string,
    expectedCompanyId: string,
    expectedType: CompanyMediaAssetType,
  ): VerifiedCompanyFile {
    this.assertMetadata(
      data,
      expectedFileId,
      expectedCompanyId,
      expectedType,
      'ACTIVE',
    );
    if (
      data.privateDelivery !== false ||
      typeof data.url !== 'string'
    ) {
      throw this.badResponse();
    }
    this.parseHttpsUrl(data.url);
    return data as unknown as VerifiedCompanyFile;
  }

  private parseDeletedFile(
    data: JsonRecord,
    expectedFileId: string,
    expectedCompanyId: string,
    expectedType: CompanyMediaAssetType,
  ): void {
    this.assertMetadata(
      data,
      expectedFileId,
      expectedCompanyId,
      expectedType,
      'DELETED',
    );
    if (data.privateDelivery !== false || data.url !== null) {
      throw this.badResponse();
    }
  }

  private assertMetadata(
    data: JsonRecord,
    expectedFileId: string,
    expectedCompanyId: string,
    expectedType: CompanyMediaAssetType,
    expectedStatus: 'ACTIVE' | 'DELETED',
  ): void {
    if (
      !this.hasExactKeys(data, METADATA_KEYS) ||
      data.id !== expectedFileId ||
      data.ownerType !== 'COMPANY' ||
      data.ownerId !== expectedCompanyId ||
      data.type !== expectedType ||
      data.status !== expectedStatus ||
      typeof data.originalFilename !== 'string' ||
      data.originalFilename.length === 0 ||
      !this.isNullableNonEmptyString(data.mimeType) ||
      !this.isNullableNonEmptyString(data.format) ||
      !this.isNullableNonNegativeInteger(data.bytes) ||
      !Number.isInteger(data.aggregateVersion) ||
      (data.aggregateVersion as number) < 1 ||
      !this.isDateTime(data.createdAt) ||
      !this.isDateTime(data.updatedAt) ||
      Date.parse(data.updatedAt as string) <
        Date.parse(data.createdAt as string)
    ) {
      throw this.badResponse();
    }
  }

  private parseReference(
    data: JsonRecord,
    expectedFileId: string,
    expectedReferenceType: string,
    expectedReferenceId: string,
  ): CompanyFileReference {
    if (
      !this.hasExactKeys(data, REFERENCE_KEYS) ||
      !UUID_V4_PATTERN.test(String(data.id ?? '')) ||
      data.fileId !== expectedFileId ||
      data.callerService !== COMPANY_SERVICE_NAME ||
      data.referenceType !== expectedReferenceType ||
      data.referenceId !== expectedReferenceId ||
      !this.isDateTime(data.createdAt)
    ) {
      throw this.badResponse();
    }
    return data as unknown as CompanyFileReference;
  }

  private assertFileExpectation(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): void {
    if (!UUID_V4_PATTERN.test(fileId)) {
      throw this.invalidRequest();
    }
    this.assertCompanyIdAndType(companyId, assetType);
  }

  private assertCompanyIdAndType(
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): void {
    if (
      !UUID_V4_PATTERN.test(companyId) ||
      !Object.prototype.hasOwnProperty.call(
        COMPANY_MEDIA_POLICIES,
        assetType,
      )
    ) {
      throw this.invalidRequest();
    }
  }

  private normalizeFilename(
    originalFilename: string,
    assetType: CompanyMediaAssetType,
  ): { originalFilename: string; format: string } {
    if (typeof originalFilename !== 'string') {
      throw this.invalidRequest();
    }
    const normalized = originalFilename.normalize('NFC').trim();
    if (
      normalized.length === 0 ||
      normalized.length > 255 ||
      /[\\/\u0000-\u001f\u007f]/u.test(normalized) ||
      /\p{Cf}/u.test(normalized)
    ) {
      throw this.invalidRequest();
    }
    const separator = normalized.lastIndexOf('.');
    const rawFormat =
      separator >= 0
        ? normalized.slice(separator + 1).toLowerCase()
        : '';
    const format = rawFormat === 'jpeg' ? 'jpg' : rawFormat;
    if (!COMPANY_MEDIA_POLICIES[assetType].formats.includes(format)) {
      throw this.invalidRequest();
    }
    return { originalFilename: normalized, format };
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
    if (configured.length === 0) {
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
    if (
      typeof rawValue !== 'string' ||
      /[\u0000-\u001f\u007f]/.test(rawValue)
    ) {
      throw this.configurationError();
    }
    const key = rawValue.trim();
    if (
      Buffer.byteLength(key, 'utf8') < 32 ||
      /(replace[-_ ]?with|change[-_ ]?me|placeholder|your[-_ ]?(key|secret)|example)/i.test(
        key,
      )
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

  private mapUpstreamStatus(
    status: number,
    purpose: 'DEFAULT' | 'DELETE' | 'UPLOAD',
  ): ApiException {
    if (status === HttpStatus.UNAUTHORIZED) {
      return new ApiException(
        'MEDIA_SERVICE_AUTH_FAILED',
        'Media Service authentication is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return new ApiException(
        'MEDIA_UPLOAD_RATE_LIMITED',
        'Media upload requests are temporarily rate limited',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (status === HttpStatus.CONFLICT && purpose === 'UPLOAD') {
      return new ApiException(
        'MEDIA_UPLOAD_CONFLICT',
        'The Company media upload slot is not available',
        HttpStatus.CONFLICT,
      );
    }
    if (status === HttpStatus.CONFLICT && purpose === 'DELETE') {
      return new ApiException(
        'MEDIA_DELETE_CONFLICT',
        'The Company media file cannot be deleted yet',
        HttpStatus.CONFLICT,
      );
    }
    if (
      status === HttpStatus.BAD_REQUEST ||
      status === HttpStatus.FORBIDDEN ||
      status === HttpStatus.NOT_FOUND ||
      status === HttpStatus.CONFLICT ||
      status === HttpStatus.GONE ||
      status === HttpStatus.PAYLOAD_TOO_LARGE ||
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
