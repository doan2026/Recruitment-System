import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageDeliveryType,
  StorageResourceType,
} from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { MediaPolicy } from '../media/media-policy';
import {
  AssetLocator,
  InspectedAsset,
  IntentAssetReconciliationResult,
  SignedUploadCapability,
  StorageAssetMismatchError,
  StorageAssetNotFoundError,
  StorageOperationOptions,
  StorageProvider,
  StorageUnavailableError,
  UploadIntentForSigning,
} from './storage-provider';

interface CloudinaryResource {
  asset_id?: unknown;
  public_id?: unknown;
  resource_type?: unknown;
  type?: unknown;
  version?: unknown;
  secure_url?: unknown;
  format?: unknown;
  bytes?: unknown;
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  etag?: unknown;
  created_at?: unknown;
  context?: {
    custom?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

interface CloudinaryDestroyResult {
  result?: unknown;
}

interface CloudinaryResourceList {
  resources?: unknown;
  next_cursor?: unknown;
}

const RESOURCE_VALUES: Record<StorageResourceType, string> = {
  [StorageResourceType.IMAGE]: 'image',
  [StorageResourceType.VIDEO]: 'video',
  [StorageResourceType.RAW]: 'raw',
};

const ALL_RESOURCE_TYPES: readonly StorageResourceType[] = [
  StorageResourceType.IMAGE,
  StorageResourceType.VIDEO,
  StorageResourceType.RAW,
];

const CONTEXT_PAGE_SIZE = 100;
const MAX_CONTEXT_PAGES = 5;
const DEFAULT_ADMIN_TIMEOUT_MS = 60_000;

const DELIVERY_VALUES: Record<StorageDeliveryType, string> = {
  [StorageDeliveryType.UPLOAD]: 'upload',
  [StorageDeliveryType.AUTHENTICATED]: 'authenticated',
};

@Injectable()
export class CloudinaryStorageProvider extends StorageProvider {
  private configured = false;

  constructor(private readonly config: ConfigService) {
    super();
  }

  assertConfiguration(): void {
    this.ensureConfigured();
    for (const environmentName of [
      'CLOUDINARY_UPLOAD_PRESET_CV',
      'CLOUDINARY_UPLOAD_PRESET_AVATAR',
      'CLOUDINARY_UPLOAD_PRESET_COMPANY_LOGO',
      'CLOUDINARY_UPLOAD_PRESET_COMPANY_IMAGE',
      'CLOUDINARY_UPLOAD_PRESET_COMPANY_VIDEO',
      'CLOUDINARY_UPLOAD_PRESET_CHAT_ATTACHMENT',
    ]) {
      this.required(environmentName);
    }
  }

  getUploadPreset(policy: MediaPolicy): string {
    return this.required(policy.presetEnvironment);
  }

  signUpload(
    intent: UploadIntentForSigning,
  ): SignedUploadCapability {
    this.ensureConfigured();
    const cloudName = this.required('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.required('CLOUDINARY_API_KEY');
    const apiSecret = this.required('CLOUDINARY_API_SECRET');
    const publicIdPrefix = intent.folder + '/';
    if (!intent.publicId.startsWith(publicIdPrefix)) {
      throw new Error('Upload public ID is outside the controlled folder');
    }
    const uploadPublicId = intent.publicId.slice(publicIdPrefix.length);
    const params: Record<string, string | number> = {
      allowed_formats: intent.expectedFormat,
      context: 'file_id=' + intent.fileId,
      folder: intent.folder,
      overwrite: 'false',
      public_id: uploadPublicId,
      timestamp: intent.signatureTimestamp,
      type: DELIVERY_VALUES[intent.policy.deliveryType],
      unique_filename: 'false',
      upload_preset: intent.uploadPreset,
      use_filename: 'false',
    };
    const signer = cloudinary.utils.api_sign_request as unknown as (
      values: Record<string, string | number>,
      secret: string,
      algorithm?: string,
    ) => string;
    const signature = signer(params, apiSecret, 'sha256');
    const resourceType = RESOURCE_VALUES[intent.policy.resourceType];

    return {
      fileId: intent.fileId,
      uploadUrl:
        'https://api.cloudinary.com/v1_1/' +
        encodeURIComponent(cloudName) +
        '/' +
        resourceType +
        '/upload',
      cloudName,
      apiKey,
      resourceType,
      expiresAt: intent.intentExpiresAt.toISOString(),
      maxBytes: intent.policy.maxBytes,
      allowedFormats: [intent.expectedFormat],
      params,
      signature,
    };
  }

  async inspectAsset(
    locator: AssetLocator,
  ): Promise<InspectedAsset> {
    this.ensureConfigured();
    const resourceType = RESOURCE_VALUES[locator.resourceType];
    const deliveryType = DELIVERY_VALUES[locator.deliveryType];

    let value: CloudinaryResource | undefined;
    try {
      value = (await cloudinary.api.resource(locator.publicId, {
        resource_type: resourceType,
        type: deliveryType,
      })) as unknown as CloudinaryResource;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw new StorageUnavailableError(
          'Cloudinary metadata lookup failed',
        );
      }
    }

    const intentAssets = await this.listIntentAssets(
      locator.contextFileId,
    );
    const hasUnexpectedAsset = intentAssets.some(
      (asset) =>
        this.requiredString(asset.public_id) !== locator.publicId ||
        this.resourceTypeFromProvider(
          this.requiredString(asset.resource_type),
        ) !== locator.resourceType ||
        this.deliveryTypeFromProvider(
          this.requiredString(asset.type),
        ) !== locator.deliveryType,
    );
    if (hasUnexpectedAsset) {
      throw new StorageAssetMismatchError(
        'Cloudinary context contains an unexpected asset identity',
      );
    }
    if (!value) {
      throw new StorageAssetNotFoundError(
        'Cloudinary asset was not found',
      );
    }

    const assetId = this.requiredString(value.asset_id);
    const publicId = this.requiredString(value.public_id);
    const responseResourceType = this.resourceTypeFromProvider(
      this.requiredString(value.resource_type),
    );
    const responseDeliveryType = this.deliveryTypeFromProvider(
      this.requiredString(value.type),
    );
    const version = String(value.version ?? '');
    const canonicalUrl = this.validateCanonicalUrl(
      this.requiredString(value.secure_url),
    );
    const format = this.assetFormat(value);
    const bytes = this.requiredPositiveInteger(value.bytes);
    const createdAt = new Date(this.requiredString(value.created_at));
    if (!Number.isFinite(createdAt.getTime()) || !version) {
      throw new StorageUnavailableError(
        'Cloudinary returned incomplete asset metadata',
      );
    }

    const result: InspectedAsset = {
      assetId,
      publicId,
      resourceType: responseResourceType,
      deliveryType: responseDeliveryType,
      version,
      canonicalUrl,
      format,
      bytes,
      createdAt,
      contextFileId: this.readContextFileId(value.context),
    };
    if (typeof value.width === 'number') {
      result.width = value.width;
    }
    if (typeof value.height === 'number') {
      result.height = value.height;
    }
    if (typeof value.duration === 'number') {
      result.durationSeconds = value.duration;
    }
    if (typeof value.etag === 'string' && value.etag) {
      result.etag = value.etag;
    }
    if (locator.resourceType === StorageResourceType.RAW) {
      result.sample = await this.readMagicSample(
        locator,
        canonicalUrl,
      );
    }
    return result;
  }

  async deleteAsset(
    locator: AssetLocator,
    options: StorageOperationOptions = {},
  ): Promise<boolean> {
    this.ensureConfigured();
    this.assertNotAborted(options.signal);
    try {
      const response = (await cloudinary.uploader.destroy(
        locator.publicId,
        {
          resource_type: RESOURCE_VALUES[locator.resourceType],
          type: DELIVERY_VALUES[locator.deliveryType],
          invalidate:
            locator.deliveryType === StorageDeliveryType.UPLOAD,
          ...(options.timeoutMs === undefined
            ? {}
            : { timeout: options.timeoutMs }),
        },
      )) as unknown as CloudinaryDestroyResult;
      if (response.result === 'not found') {
        return false;
      }
      if (response.result !== 'ok') {
        throw new StorageUnavailableError(
          'Cloudinary did not confirm deletion',
        );
      }
      return true;
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        throw error;
      }
      if (this.isNotFound(error)) {
        return false;
      }
      throw new StorageUnavailableError('Cloudinary deletion failed');
    }
  }

  async deleteIntentAssets(
    contextFileId: string,
    options: StorageOperationOptions = {},
  ): Promise<void> {
    await this.reconcileIntentAssets(contextFileId, null, options);
  }

  async reconcileIntentAssets(
    contextFileId: string,
    preserve: AssetLocator | null,
    options: StorageOperationOptions = {},
  ): Promise<IntentAssetReconciliationResult> {
    this.ensureConfigured();
    const resources = await this.listIntentAssets(
      contextFileId,
      ALL_RESOURCE_TYPES,
      options,
    );
    const assets = resources.map((resource) => ({
      assetId: this.requiredString(resource.asset_id),
      locator: {
        publicId: this.requiredString(resource.public_id),
        resourceType: this.resourceTypeFromProvider(
          this.requiredString(resource.resource_type),
        ),
        deliveryType: this.deliveryTypeFromProvider(
          this.requiredString(resource.type),
        ),
        expectedFormat: this.assetFormat(resource),
        contextFileId,
      } satisfies AssetLocator,
    }));
    const isExpected = (asset: {
      assetId: string;
      locator: AssetLocator;
    }): boolean =>
      preserve !== null &&
      asset.locator.publicId === preserve.publicId &&
      asset.locator.resourceType === preserve.resourceType &&
      asset.locator.deliveryType === preserve.deliveryType &&
      asset.locator.expectedFormat === preserve.expectedFormat &&
      (preserve.expectedAssetId === undefined ||
        asset.assetId === preserve.expectedAssetId);
    const unexpected = assets.filter(
      (asset) => !isExpected(asset),
    );
    const deletionResults = await Promise.all(
      unexpected.map((asset) =>
        this.deleteAsset(asset.locator, options),
      ),
    );
    return {
      observedAssets: assets.length,
      deletedAssets: deletionResults.filter(Boolean).length,
      preservedExpectedAsset:
        preserve !== null && assets.some(isExpected),
    };
  }

  createDownloadUrl(
    locator: AssetLocator,
    filename: string,
    expiresAt: Date,
    canonicalUrl: string,
  ): string {
    this.ensureConfigured();
    if (locator.deliveryType === StorageDeliveryType.UPLOAD) {
      return this.validateCanonicalUrl(canonicalUrl);
    }

    const generator = cloudinary.utils
      .private_download_url as unknown as (
        publicId: string,
        format: string,
        options: Record<string, unknown>,
      ) => string;
    // RAW public IDs already include the extension; stripping it addresses a
    // different asset. The private Download API expects the complete identity.
    const downloadFormat = locator.resourceType === StorageResourceType.RAW
      ? '' : locator.expectedFormat;
    return generator(locator.publicId, downloadFormat, {
      resource_type: RESOURCE_VALUES[locator.resourceType],
      type: DELIVERY_VALUES[locator.deliveryType],
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      attachment: true,
      target_filename: filename,
    });
  }

  private ensureConfigured(): void {
    if (this.configured) {
      return;
    }
    cloudinary.config({
      cloud_name: this.required('CLOUDINARY_CLOUD_NAME'),
      api_key: this.required('CLOUDINARY_API_KEY'),
      api_secret: this.required('CLOUDINARY_API_SECRET'),
      secure: true,
      signature_algorithm: 'sha256',
    });
    this.configured = true;
  }

  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim() ?? '';
    if (!value || value.toLowerCase().includes('replace-with')) {
      throw new StorageUnavailableError(
        name + ' must be configured with a non-placeholder value',
      );
    }
    return value;
  }

  private requiredString(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new StorageUnavailableError(
        'Cloudinary returned incomplete asset metadata',
      );
    }
    return value.trim();
  }

  private requiredPositiveInteger(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      throw new StorageUnavailableError(
        'Cloudinary returned an invalid asset size',
      );
    }
    return value;
  }

  private normalizeFormat(format: string): string {
    return format.toLowerCase() === 'jpeg'
      ? 'jpg'
      : format.toLowerCase();
  }

  private assetFormat(resource: CloudinaryResource): string {
    if (typeof resource.format === 'string' && resource.format.trim()) {
      return this.normalizeFormat(resource.format.trim());
    }
    // Cloudinary RAW metadata omits format; its canonical public_id includes
    // the extension. Confirm still checks the intent and actual magic bytes.
    if (resource.resource_type === 'raw') {
      const publicId = this.requiredString(resource.public_id);
      const extension = /\.([a-z0-9]+)$/i.exec(
        publicId.slice(publicId.lastIndexOf('/') + 1),
      );
      if (extension) return this.normalizeFormat(extension[1]);
    }
    throw new StorageUnavailableError(
      'Cloudinary returned incomplete asset format metadata',
    );
  }

  private resourceTypeFromProvider(
    value: string,
  ): StorageResourceType {
    const entry = Object.entries(RESOURCE_VALUES).find(
      ([, providerValue]) => providerValue === value,
    );
    if (!entry) {
      throw new StorageUnavailableError(
        'Cloudinary returned an unknown resource type',
      );
    }
    return entry[0] as StorageResourceType;
  }

  private deliveryTypeFromProvider(
    value: string,
  ): StorageDeliveryType {
    const entry = Object.entries(DELIVERY_VALUES).find(
      ([, providerValue]) => providerValue === value,
    );
    if (!entry) {
      throw new StorageUnavailableError(
        'Cloudinary returned an unknown delivery type',
      );
    }
    return entry[0] as StorageDeliveryType;
  }

  private readContextFileId(
    context: CloudinaryResource['context'],
  ): string | undefined {
    const value = context?.custom?.file_id ?? context?.file_id;
    return typeof value === 'string' ? value : undefined;
  }

  private async listIntentAssets(
    contextFileId: string,
    resourceTypes: readonly StorageResourceType[] =
      ALL_RESOURCE_TYPES,
    options: StorageOperationOptions = {},
  ): Promise<CloudinaryResource[]> {
    try {
      const pages = await Promise.all(
        resourceTypes.map((resourceType) =>
          this.listIntentAssetsForResourceType(
            contextFileId,
            resourceType,
            options,
          ),
        ),
      );
      return pages.flat();
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        throw error;
      }
      throw new StorageUnavailableError(
        'Cloudinary context lookup failed',
      );
    }
  }

  private async listIntentAssetsForResourceType(
    contextFileId: string,
    resourceType: StorageResourceType,
    options: StorageOperationOptions,
  ): Promise<CloudinaryResource[]> {
    const resources: CloudinaryResource[] = [];
    let nextCursor: string | undefined;
    for (let page = 0; page < MAX_CONTEXT_PAGES; page += 1) {
      const response =
        await this.fetchIntentAssetsPage(
          contextFileId,
          resourceType,
          nextCursor,
          options,
        );
      if (!Array.isArray(response.resources)) {
        throw new StorageUnavailableError(
          'Cloudinary returned an invalid context lookup',
        );
      }
      for (const value of response.resources) {
        const resource = value as CloudinaryResource;
        if (
          typeof value !== 'object' ||
          value === null ||
          this.readContextFileId(resource.context) !== contextFileId
        ) {
          throw new StorageUnavailableError(
            'Cloudinary returned inconsistent asset context',
          );
        }
        this.requiredString(resource.asset_id);
        this.requiredString(resource.public_id);
        this.assetFormat(resource);
        const actualResourceType = this.resourceTypeFromProvider(
          this.requiredString(resource.resource_type),
        );
        this.deliveryTypeFromProvider(
          this.requiredString(resource.type),
        );
        if (actualResourceType !== resourceType) {
          throw new StorageUnavailableError(
            'Cloudinary returned an inconsistent resource type',
          );
        }
        resources.push(resource);
      }

      if (
        response.next_cursor !== undefined &&
        (typeof response.next_cursor !== 'string' ||
          response.next_cursor.length === 0)
      ) {
        throw new StorageUnavailableError(
          'Cloudinary returned an invalid context cursor',
        );
      }
      nextCursor = response.next_cursor as string | undefined;
      if (nextCursor === undefined) {
        return resources;
      }
    }
    throw new StorageUnavailableError(
      'Cloudinary context lookup exceeded the safe page limit',
    );
  }

  private async fetchIntentAssetsPage(
    contextFileId: string,
    resourceType: StorageResourceType,
    nextCursor: string | undefined,
    options: StorageOperationOptions,
  ): Promise<CloudinaryResourceList> {
    this.assertNotAborted(options.signal);
    const timeoutMs = options.timeoutMs ?? DEFAULT_ADMIN_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new StorageUnavailableError(
        'Cloudinary request timeout is invalid',
      );
    }
    const cloudName = this.required('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.required('CLOUDINARY_API_KEY');
    const apiSecret = this.required('CLOUDINARY_API_SECRET');
    const url = new URL(
      'https://api.cloudinary.com/v1_1/' +
        encodeURIComponent(cloudName) +
        '/resources/' +
        RESOURCE_VALUES[resourceType] +
        '/context',
    );
    url.searchParams.set('key', 'file_id');
    url.searchParams.set('value', contextFileId);
    url.searchParams.set('max_results', String(CONTEXT_PAGE_SIZE));
    url.searchParams.set('context', 'true');
    if (nextCursor !== undefined) {
      url.searchParams.set('next_cursor', nextCursor);
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization:
            'Basic ' +
            Buffer.from(apiKey + ':' + apiSecret).toString('base64'),
        },
        redirect: 'error',
        signal,
      });
    } catch {
      throw new StorageUnavailableError(
        'Cloudinary context lookup failed',
      );
    }
    if (!response.ok) {
      throw new StorageUnavailableError(
        'Cloudinary context lookup returned an error',
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new StorageUnavailableError(
        'Cloudinary returned an invalid context lookup',
      );
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new StorageUnavailableError(
        'Cloudinary returned an invalid context lookup',
      );
    }
    return payload as CloudinaryResourceList;
  }

  private assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new StorageUnavailableError(
        'Cloudinary operation was cancelled',
      );
    }
  }

  private validateCanonicalUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new StorageUnavailableError(
        'Cloudinary returned an invalid canonical URL',
      );
    }
    const cloudName = this.required('CLOUDINARY_CLOUD_NAME');
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'res.cloudinary.com' ||
      !url.pathname.startsWith('/' + cloudName + '/')
    ) {
      throw new StorageUnavailableError(
        'Cloudinary returned an unexpected canonical URL',
      );
    }
    return url.toString();
  }

  private async readMagicSample(
    locator: AssetLocator,
    fallbackUrl: string,
  ): Promise<Buffer> {
    let inspectionUrl = fallbackUrl;
    if (locator.deliveryType === StorageDeliveryType.AUTHENTICATED) {
      inspectionUrl = this.createDownloadUrl(
        locator,
        'inspection.' + locator.expectedFormat,
        new Date(Date.now() + 60_000),
        fallbackUrl,
      );
    }

    let response: Response;
    try {
      response = await fetch(inspectionUrl, {
        headers: { range: 'bytes=0-8191' },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new StorageUnavailableError(
        'Cloudinary asset inspection failed',
      );
    }
    if (!response.ok || !response.body) {
      throw new StorageUnavailableError(
        'Cloudinary asset inspection returned an error',
      );
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (size < 8192) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        const remaining = 8192 - size;
        const chunk = Buffer.from(next.value).subarray(0, remaining);
        chunks.push(chunk);
        size += chunk.length;
        if (chunk.length < next.value.length) {
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }

  private isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const candidate = error as {
      http_code?: unknown;
      error?: { http_code?: unknown };
    };
    return (
      candidate.http_code === 404 ||
      candidate.error?.http_code === 404
    );
  }
}
