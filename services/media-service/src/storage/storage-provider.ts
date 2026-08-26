import {
  StorageDeliveryType,
  StorageResourceType,
} from '@prisma/client';
import { MediaPolicy } from '../media/media-policy';

export interface UploadIntentForSigning {
  fileId: string;
  publicId: string;
  folder: string;
  expectedFormat: string;
  uploadPreset: string;
  signatureTimestamp: number;
  intentExpiresAt: Date;
  policy: MediaPolicy;
}

export interface SignedUploadCapability {
  fileId: string;
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  resourceType: string;
  expiresAt: string;
  maxBytes: number;
  allowedFormats: readonly string[];
  params: Record<string, string | number>;
  signature: string;
}

export interface AssetLocator {
  publicId: string;
  resourceType: StorageResourceType;
  deliveryType: StorageDeliveryType;
  expectedFormat: string;
  contextFileId: string;
}

export interface InspectedAsset {
  assetId: string;
  publicId: string;
  resourceType: StorageResourceType;
  deliveryType: StorageDeliveryType;
  version: string;
  canonicalUrl: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  etag?: string;
  createdAt: Date;
  contextFileId?: string;
  sample?: Buffer;
}

export class StorageAssetNotFoundError extends Error {}
export class StorageAssetMismatchError extends Error {}
export class StorageUnavailableError extends Error {}

export abstract class StorageProvider {
  abstract assertConfiguration(): void;
  abstract getUploadPreset(policy: MediaPolicy): string;
  abstract signUpload(
    intent: UploadIntentForSigning,
  ): SignedUploadCapability;
  abstract inspectAsset(locator: AssetLocator): Promise<InspectedAsset>;
  abstract deleteAsset(locator: AssetLocator): Promise<void>;
  abstract deleteIntentAssets(
    contextFileId: string,
  ): Promise<void>;
  abstract createDownloadUrl(
    locator: AssetLocator,
    filename: string,
    expiresAt: Date,
    canonicalUrl: string,
  ): string;
}
