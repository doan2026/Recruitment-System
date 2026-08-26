'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const {
  StorageDeliveryType,
  StorageResourceType,
} = require('@prisma/client');
const { v2: cloudinary } = require('cloudinary');
const {
  MEDIA_POLICIES,
} = require('../dist/media/media-policy');
const {
  CloudinaryStorageProvider,
} = require('../dist/storage/cloudinary-storage.provider');
const {
  StorageAssetMismatchError,
  StorageAssetNotFoundError,
  StorageUnavailableError,
} = require('../dist/storage/storage-provider');

const CONTEXT_FILE_ID = '10000000-0000-4000-8000-000000000001';

const configValues = {
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-api-key',
  CLOUDINARY_API_SECRET: 'test-api-secret',
  CLOUDINARY_UPLOAD_PRESET_CV: 'test-cv',
  CLOUDINARY_UPLOAD_PRESET_AVATAR: 'test-avatar',
  CLOUDINARY_UPLOAD_PRESET_COMPANY_LOGO: 'test-company-logo',
  CLOUDINARY_UPLOAD_PRESET_COMPANY_IMAGE: 'test-company-image',
  CLOUDINARY_UPLOAD_PRESET_COMPANY_VIDEO: 'test-company-video',
  CLOUDINARY_UPLOAD_PRESET_CHAT_ATTACHMENT: 'test-chat',
};

const createProvider = (overrides = {}) =>
  new CloudinaryStorageProvider(
    new ConfigService({ ...configValues, ...overrides }),
  );

test('Cloudinary adapter fails closed on missing or placeholder configuration', () => {
  assert.throws(() =>
    createProvider({ CLOUDINARY_API_SECRET: '' }).assertConfiguration(),
  );
  assert.throws(() =>
    createProvider({
      CLOUDINARY_UPLOAD_PRESET_CV: 'replace-with-preset',
    }).assertConfiguration(),
  );
  assert.doesNotThrow(() => createProvider().assertConfiguration());
});

test('Cloudinary signed intent contains only controlled exact-format parameters', () => {
  const provider = createProvider();
  const timestamp = 1_800_000_000;
  const capability = provider.signUpload({
    fileId: '10000000-0000-4000-8000-000000000001',
    publicId:
      'recruitment/avatar/10000000-0000-4000-8000-000000000001',
    folder: 'recruitment/avatar',
    expectedFormat: 'jpg',
    uploadPreset: 'test-avatar',
    signatureTimestamp: timestamp,
    intentExpiresAt: new Date('2027-01-15T08:10:00.000Z'),
    policy: MEDIA_POLICIES.AVATAR,
  });

  assert.equal(
    capability.uploadUrl,
    'https://api.cloudinary.com/v1_1/test-cloud/image/upload',
  );
  assert.deepEqual(capability.allowedFormats, ['jpg']);
  assert.deepEqual(capability.params, {
    allowed_formats: 'jpg',
    context: 'file_id=10000000-0000-4000-8000-000000000001',
    folder: 'recruitment/avatar',
    overwrite: 'false',
    public_id: '10000000-0000-4000-8000-000000000001',
    timestamp,
    type: 'upload',
    unique_filename: 'false',
    upload_preset: 'test-avatar',
    use_filename: 'false',
  });
  assert.equal(
    capability.signature,
    cloudinary.utils.api_sign_request(
      capability.params,
      configValues.CLOUDINARY_API_SECRET,
      'sha256',
    ),
  );
  assert.equal(
    JSON.stringify(capability).includes(
      configValues.CLOUDINARY_API_SECRET,
    ),
    false,
  );
});

test('Cloudinary canonical inspection uses Admin metadata and bounded range bytes', async (t) => {
  const originalResource = cloudinary.api.resource;
  const originalResourcesByContext =
    cloudinary.api.resources_by_context;
  const originalUrl = cloudinary.url;
  const originalFetch = global.fetch;
  t.after(() => {
    cloudinary.api.resource = originalResource;
    cloudinary.api.resources_by_context = originalResourcesByContext;
    cloudinary.url = originalUrl;
    global.fetch = originalFetch;
  });

  const publicId =
    'recruitment/cv/10000000-0000-4000-8000-000000000001.pdf';
  let lookupOptions;
  cloudinary.api.resource = async (value, options) => {
    assert.equal(value, publicId);
    lookupOptions = options;
    return {
      asset_id: 'asset-1',
      public_id: publicId,
      resource_type: 'raw',
      type: 'authenticated',
      version: 1800000000,
      secure_url:
        'https://res.cloudinary.com/test-cloud/raw/authenticated/v1800000000/' +
        publicId,
      format: 'pdf',
      bytes: 4096,
      etag: 'etag-1',
      created_at: '2027-01-15T08:00:00.000Z',
      context: {
        custom: {
          file_id: CONTEXT_FILE_ID,
        },
      },
    };
  };
  const contextLookups = [];
  cloudinary.api.resources_by_context = async (
    key,
    value,
    options,
  ) => {
    assert.equal(key, 'file_id');
    assert.equal(value, CONTEXT_FILE_ID);
    contextLookups.push(options);
    return { resources: [] };
  };

  cloudinary.url = (value, options) => {
    assert.equal(value, publicId);
    assert.equal(options.sign_url, true);
    return (
      'https://res.cloudinary.com/test-cloud/raw/authenticated/' +
      publicId
    );
  };
  let fetchOptions;
  global.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/res\.cloudinary\.com\/test-cloud\//);
    fetchOptions = options;
    return new Response(Buffer.from('%PDF-1.7\n'), { status: 206 });
  };

  const provider = createProvider();
  const inspected = await provider.inspectAsset({
    publicId,
    resourceType: StorageResourceType.RAW,
    deliveryType: StorageDeliveryType.AUTHENTICATED,
    expectedFormat: 'pdf',
    contextFileId: CONTEXT_FILE_ID,
  });
  assert.deepEqual(lookupOptions, {
    resource_type: 'raw',
    type: 'authenticated',
  });
  assert.equal(fetchOptions.headers.range, 'bytes=0-8191');
  assert.equal(fetchOptions.redirect, 'error');
  assert.equal(inspected.contextFileId, CONTEXT_FILE_ID);
  assert.equal(inspected.sample.toString(), '%PDF-1.7\n');
  assert.deepEqual(
    new Set(contextLookups.map((options) => options.resource_type)),
    new Set(['image', 'video', 'raw']),
  );

  cloudinary.api.resource = async () => ({
    asset_id: 'asset-2',
    public_id: publicId,
    resource_type: 'raw',
    type: 'authenticated',
    version: 1800000000,
    secure_url: 'https://attacker.example/file.pdf',
    format: 'pdf',
    bytes: 10,
    created_at: '2027-01-15T08:00:00.000Z',
  });
  await assert.rejects(
    () =>
      provider.inspectAsset({
        publicId,
        resourceType: StorageResourceType.RAW,
        deliveryType: StorageDeliveryType.AUTHENTICATED,
        expectedFormat: 'pdf',
        contextFileId: CONTEXT_FILE_ID,
      }),
    StorageUnavailableError,
  );

  cloudinary.api.resource = async () => {
    throw { error: { http_code: 404 } };
  };
  await assert.rejects(
    () =>
      provider.inspectAsset({
        publicId,
        resourceType: StorageResourceType.RAW,
        deliveryType: StorageDeliveryType.AUTHENTICATED,
        expectedFormat: 'pdf',
        contextFileId: CONTEXT_FILE_ID,
      }),
    StorageAssetNotFoundError,
  );

  const alternateResource = {
    asset_id: 'alternate-image-asset',
    public_id: publicId,
    resource_type: 'image',
    type: 'authenticated',
    format: 'pdf',
    context: { custom: { file_id: CONTEXT_FILE_ID } },
  };
  cloudinary.api.resources_by_context = async (
    key,
    value,
    options,
  ) => {
    assert.equal(key, 'file_id');
    assert.equal(value, CONTEXT_FILE_ID);
    const matchesAlternate =
      options.resource_type === 'image' &&
      (options.type === undefined || options.type === 'authenticated');
    return {
      resources: matchesAlternate ? [alternateResource] : [],
    };
  };

  await assert.rejects(
    () =>
      provider.inspectAsset({
        publicId,
        resourceType: StorageResourceType.RAW,
        deliveryType: StorageDeliveryType.AUTHENTICATED,
        expectedFormat: 'pdf',
        contextFileId: CONTEXT_FILE_ID,
      }),
    StorageAssetMismatchError,
  );

  cloudinary.api.resources_by_context = async (
    key,
    value,
    options,
  ) => ({
    resources:
      options.resource_type === 'image'
        ? [
            {
              ...alternateResource,
              resource_type: 'video',
            },
          ]
        : [],
  });
  await assert.rejects(
    () =>
      provider.inspectAsset({
        publicId,
        resourceType: StorageResourceType.RAW,
        deliveryType: StorageDeliveryType.AUTHENTICATED,
        expectedFormat: 'pdf',
        contextFileId: CONTEXT_FILE_ID,
      }),
    StorageUnavailableError,
  );
});

test('Cloudinary private download and deletion preserve raw asset identity', async (t) => {
  const originalDownload = cloudinary.utils.private_download_url;
  const originalDestroy = cloudinary.uploader.destroy;
  const originalResourcesByContext =
    cloudinary.api.resources_by_context;
  t.after(() => {
    cloudinary.utils.private_download_url = originalDownload;
    cloudinary.uploader.destroy = originalDestroy;
    cloudinary.api.resources_by_context = originalResourcesByContext;
  });

  let downloadCall;
  cloudinary.utils.private_download_url = (
    publicId,
    format,
    options,
  ) => {
    downloadCall = { publicId, format, options };
    return 'https://download.example/signed';
  };
  let destroyCall;
  cloudinary.uploader.destroy = async (publicId, options) => {
    destroyCall = { publicId, options };
    return { result: 'ok' };
  };

  const provider = createProvider();
  const locator = {
    publicId:
      'recruitment/cv/10000000-0000-4000-8000-000000000001.pdf',
    resourceType: StorageResourceType.RAW,
    deliveryType: StorageDeliveryType.AUTHENTICATED,
    expectedFormat: 'pdf',
    contextFileId: CONTEXT_FILE_ID,
  };
  const expiresAt = new Date('2027-01-15T08:05:00.000Z');
  assert.equal(
    provider.createDownloadUrl(
      locator,
      'candidate.pdf',
      expiresAt,
      'https://res.cloudinary.com/test-cloud/raw/authenticated/file.pdf',
    ),
    'https://download.example/signed',
  );
  assert.equal(
    downloadCall.publicId,
    'recruitment/cv/10000000-0000-4000-8000-000000000001',
  );
  assert.equal(downloadCall.format, 'pdf');
  assert.equal(
    downloadCall.options.expires_at,
    Math.floor(expiresAt.getTime() / 1000),
  );

  await provider.deleteAsset(locator);
  assert.equal(destroyCall.publicId, locator.publicId);
  assert.deepEqual(destroyCall.options, {
    resource_type: 'raw',
    type: 'authenticated',
    invalidate: false,
  });

  const alternatePublicId =
    'recruitment/cv/alternate-image.pdf';
  cloudinary.api.resources_by_context = async (
    key,
    value,
    options,
  ) => {
    assert.equal(key, 'file_id');
    assert.equal(value, CONTEXT_FILE_ID);
    const matchesAlternate =
      options.resource_type === 'image' &&
      (options.type === undefined || options.type === 'authenticated');
    return {
      resources: matchesAlternate
        ? [
            {
              asset_id: 'alternate-image-asset',
              public_id: alternatePublicId,
              resource_type: 'image',
              type: 'authenticated',
              format: 'pdf',
              context: { custom: { file_id: CONTEXT_FILE_ID } },
            },
          ]
        : [],
    };
  };
  await provider.deleteIntentAssets(CONTEXT_FILE_ID);
  assert.equal(destroyCall.publicId, alternatePublicId);
  assert.deepEqual(destroyCall.options, {
    resource_type: 'image',
    type: 'authenticated',
    invalidate: false,
  });

  cloudinary.uploader.destroy = async () => ({ result: 'pending' });
  await assert.rejects(
    () => provider.deleteAsset(locator),
    StorageUnavailableError,
  );
});
