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
  SignedUploadCapability,
  StorageAssetMismatchError,
  StorageAssetNotFoundError,
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
    const format = this.normalizeFormat(
      this.requiredString(value.format),
    );
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
        result.version,
        canonicalUrl,
      );
    }
    return result;
  }

  async deleteAsset(locator: AssetLocator): Promise<void> {
    this.ensureConfigured();
    try {
      const response = (await cloudinary.uploader.destroy(
        locator.publicId,
        {
          resource_type: RESOURCE_VALUES[locator.resourceType],
          type: DELIVERY_VALUES[locator.deliveryType],
          invalidate:
            locator.deliveryType === StorageDeliveryType.UPLOAD,
        },
      )) as unknown as CloudinaryDestroyResult;
      if (response.result !== 'ok' && response.result !== 'not found') {
        throw new StorageUnavailableError(
          'Cloudinary did not confirm deletion',
        );
      }
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        throw error;
      }
      if (this.isNotFound(error)) {
        return;
      }
      throw new StorageUnavailableError('Cloudinary deletion failed');
    }
  }

  async deleteIntentAssets(contextFileId: string): Promise<void> {
    this.ensureConfigured();
    const resources = await this.listIntentAssets(contextFileId);
    await Promise.all(
      resources.map((resource) =>
        this.deleteAsset({
          publicId: this.requiredString(resource.public_id),
          resourceType: this.resourceTypeFromProvider(
            this.requiredString(resource.resource_type),
          ),
          deliveryType: this.deliveryTypeFromProvider(
            this.requiredString(resource.type),
          ),
          expectedFormat: this.normalizeFormat(
            this.requiredString(resource.format),
          ),
          contextFileId,
        }),
      ),
    );
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
    const rawSuffix = '.' + locator.expectedFormat;
    const downloadPublicId =
      locator.resourceType === StorageResourceType.RAW &&
      locator.publicId.endsWith(rawSuffix)
        ? locator.publicId.slice(0, -rawSuffix.length)
        : locator.publicId;
    return generator(downloadPublicId, locator.expectedFormat, {
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
  ): Promise<CloudinaryResource[]> {
    let responses: Array<{
      resourceType: StorageResourceType;
      response: CloudinaryResourceList;
    }>;
    try {
      responses = await Promise.all(
        resourceTypes.map(
          async (resourceType) =>
            ({
              resourceType,
              response:
                (await cloudinary.api.resources_by_context(
                  'file_id',
                  contextFileId,
                  {
                    resource_type: RESOURCE_VALUES[resourceType],
                    max_results: 10,
                    context: true,
                  },
                )) as unknown as CloudinaryResourceList,
            }),
        ),
      );
    } catch {
      throw new StorageUnavailableError(
        'Cloudinary context lookup failed',
      );
    }

    const resources: CloudinaryResource[] = [];
    for (const { resourceType, response } of responses) {
      if (
        !Array.isArray(response.resources) ||
        response.next_cursor
      ) {
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
        this.requiredString(resource.format);
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
    }
    return resources;
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
    version: string,
    fallbackUrl: string,
  ): Promise<Buffer> {
    const deliveryType = DELIVERY_VALUES[locator.deliveryType];
    let inspectionUrl = fallbackUrl;
    if (locator.deliveryType === StorageDeliveryType.AUTHENTICATED) {
      inspectionUrl = cloudinary.url(locator.publicId, {
        secure: true,
        resource_type: RESOURCE_VALUES[locator.resourceType],
        type: deliveryType,
        version,
        sign_url: true,
      });
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
