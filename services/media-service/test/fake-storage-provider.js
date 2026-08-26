'use strict';

const {
  StorageDeliveryType,
  StorageResourceType,
} = require('@prisma/client');
const {
  StorageAssetNotFoundError,
  StorageProvider,
  StorageUnavailableError,
} = require('../dist/storage/storage-provider');

const presetByType = {
  CV: 'test_cv_signed',
  AVATAR: 'test_avatar_signed',
  COMPANY_LOGO: 'test_company_logo_signed',
  COMPANY_IMAGE: 'test_company_image_signed',
  COMPANY_VIDEO: 'test_company_video_signed',
  CHAT_ATTACHMENT: 'test_chat_attachment_signed',
};

class FakeStorageProvider extends StorageProvider {
  constructor() {
    super();
    this.assets = new Map();
    this.inspectCalls = [];
    this.deleteCalls = [];
    this.failInspect = false;
    this.failDelete = false;
    this.inspectDelayMs = 0;
    this.inspectHook = null;
    this.deleteHook = null;
  }

  assertConfiguration() {}

  getUploadPreset(policy) {
    return presetByType[policy.mediaType];
  }

  signUpload(intent) {
    const prefix = intent.folder + '/';
    const publicId = intent.publicId.slice(prefix.length);
    return {
      fileId: intent.fileId,
      uploadUrl:
        'https://api.cloudinary.com/v1_1/test-cloud/' +
        intent.policy.resourceType.toLowerCase() +
        '/upload',
      cloudName: 'test-cloud',
      apiKey: 'test-api-key',
      resourceType: intent.policy.resourceType.toLowerCase(),
      expiresAt: intent.intentExpiresAt.toISOString(),
      maxBytes: intent.policy.maxBytes,
      allowedFormats: [intent.expectedFormat],
      params: {
        allowed_formats: intent.expectedFormat,
        context: 'file_id=' + intent.fileId,
        folder: intent.folder,
        overwrite: 'false',
        public_id: publicId,
        timestamp: intent.signatureTimestamp,
        type: intent.policy.deliveryType.toLowerCase(),
        unique_filename: 'false',
        upload_preset: intent.uploadPreset,
        use_filename: 'false',
      },
      signature: 'fake-signature-' + intent.fileId,
    };
  }

  async inspectAsset(locator) {
    this.inspectCalls.push(locator);
    if (this.inspectHook) {
      await this.inspectHook(locator);
    }
    if (this.inspectDelayMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.inspectDelayMs),
      );
    }
    if (this.failInspect) {
      throw new StorageUnavailableError('simulated lookup outage');
    }
    const asset = this.assets.get(locator.publicId);
    if (!asset) {
      throw new StorageAssetNotFoundError('simulated missing asset');
    }
    return {
      ...asset,
      sample: asset.sample
        ? Buffer.from(asset.sample)
        : undefined,
    };
  }

  async deleteAsset(locator) {
    this.deleteCalls.push(locator.publicId);
    if (this.deleteHook) {
      await this.deleteHook(locator);
    }
    if (this.failDelete) {
      throw new StorageUnavailableError('simulated delete outage');
    }
    this.assets.delete(locator.publicId);
  }

  async deleteIntentAssets(contextFileId) {
    const matches = [...this.assets.values()].filter(
      (asset) => asset.contextFileId === contextFileId,
    );
    await Promise.all(
      matches.map((asset) =>
        this.deleteAsset({
          publicId: asset.publicId,
          resourceType: asset.resourceType,
          deliveryType: asset.deliveryType,
          expectedFormat: asset.format,
          contextFileId,
        }),
      ),
    );
  }

  createDownloadUrl(locator, filename, expiresAt, canonicalUrl) {
    if (locator.deliveryType === StorageDeliveryType.UPLOAD) {
      return canonicalUrl;
    }
    return (
      'https://download.test/' +
      encodeURIComponent(locator.publicId) +
      '?filename=' +
      encodeURIComponent(filename) +
      '&expires=' +
      Math.floor(expiresAt.getTime() / 1000)
    );
  }

  register(file, overrides = {}) {
    const defaultSample =
      file.expectedFormat === 'pdf'
        ? Buffer.from('%PDF-1.7\n')
        : file.expectedFormat === 'docx'
          ? Buffer.from([0x50, 0x4b, 0x03, 0x04])
          : file.expectedFormat === 'doc'
            ? Buffer.from([
                0xd0, 0xcf, 0x11, 0xe0,
                0xa1, 0xb1, 0x1a, 0xe1,
              ])
            : file.expectedFormat === 'jpg'
              ? Buffer.from([0xff, 0xd8, 0xff, 0xe0])
              : file.expectedFormat === 'png'
                ? Buffer.from([
                    0x89, 0x50, 0x4e, 0x47,
                    0x0d, 0x0a, 0x1a, 0x0a,
                  ])
                : file.expectedFormat === 'webp'
                  ? Buffer.from('RIFF0000WEBP')
                  : Buffer.from('0000ftyp');
    const resource = {
      assetId: 'asset-' + file.id,
      publicId: file.publicId,
      resourceType: file.storageResourceType,
      deliveryType: file.storageDeliveryType,
      version: '1700000000',
      canonicalUrl:
        'https://res.cloudinary.com/test-cloud/' +
        file.storageResourceType.toLowerCase() +
        '/' +
        file.storageDeliveryType.toLowerCase() +
        '/v1700000000/' +
        file.publicId,
      format: file.expectedFormat,
      bytes: 1024,
      width:
        file.storageResourceType === StorageResourceType.IMAGE
          ? 800
          : undefined,
      height:
        file.storageResourceType === StorageResourceType.IMAGE
          ? 600
          : undefined,
      durationSeconds:
        file.storageResourceType === StorageResourceType.VIDEO
          ? 30
          : undefined,
      etag: 'etag-' + file.id,
      createdAt: new Date(file.createdAt),
      contextFileId: file.id,
      sample: defaultSample,
      ...overrides,
    };
    this.assets.set(file.publicId, resource);
    return resource;
  }
}

module.exports = { FakeStorageProvider };
