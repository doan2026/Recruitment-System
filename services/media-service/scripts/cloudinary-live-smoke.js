'use strict';

const { randomUUID } = require('node:crypto');
const { readFile, stat } = require('node:fs/promises');
const { basename, extname } = require('node:path');
const { ConfigService } = require('@nestjs/config');
const { v2: cloudinary } = require('cloudinary');
const {
  MEDIA_POLICIES,
} = require('../dist/media/media-policy');
const {
  CloudinaryStorageProvider,
} = require('../dist/storage/cloudinary-storage.provider');

const EXPECTED_MEDIA_TYPES = Object.freeze([
  'CV',
  'AVATAR',
  'COMPANY_LOGO',
  'COMPANY_IMAGE',
  'COMPANY_VIDEO',
  'CHAT_ATTACHMENT',
]);
const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_HTTP_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;

const ROUTES = Object.freeze({
  CV: {
    service: 'profile-service',
    ownerType: 'USER',
    keyName: 'INTERNAL_API_KEY_PROFILE',
    fixtureName: 'CLOUDINARY_LIVE_SMOKE_PDF_PATH',
  },
  AVATAR: {
    service: 'profile-service',
    ownerType: 'USER',
    keyName: 'INTERNAL_API_KEY_PROFILE',
    fixtureName: 'CLOUDINARY_LIVE_SMOKE_IMAGE_PATH',
  },
  COMPANY_LOGO: {
    service: 'company-service',
    ownerType: 'COMPANY',
    keyName: 'INTERNAL_API_KEY_COMPANY',
    fixtureName: 'CLOUDINARY_LIVE_SMOKE_IMAGE_PATH',
  },
  COMPANY_IMAGE: {
    service: 'company-service',
    ownerType: 'COMPANY',
    keyName: 'INTERNAL_API_KEY_COMPANY',
    fixtureName: 'CLOUDINARY_LIVE_SMOKE_IMAGE_PATH',
  },
  COMPANY_VIDEO: {
    service: 'company-service',
    ownerType: 'COMPANY',
    keyName: 'INTERNAL_API_KEY_COMPANY',
    fixtureName: 'CLOUDINARY_LIVE_SMOKE_VIDEO_PATH',
  },
  CHAT_ATTACHMENT: {
    service: 'chat-service',
    ownerType: 'USER',
    keyName: 'INTERNAL_API_KEY_CHAT',
    fixtureName: 'CLOUDINARY_LIVE_SMOKE_PDF_PATH',
  },
});

const RESOURCE_VALUES = Object.freeze({
  IMAGE: 'image',
  VIDEO: 'video',
  RAW: 'raw',
});
const DELIVERY_VALUES = Object.freeze({
  UPLOAD: 'upload',
  AUTHENTICATED: 'authenticated',
});

class LiveSmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LiveSmokeError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new LiveSmokeError(code, message);
};

const assertCondition = (condition, code, message) => {
  if (!condition) {
    fail(code, message);
  }
};

const requiredEnvironment = (environment, name) => {
  const value = String(environment[name] ?? '').trim();
  if (!value || value.toLowerCase().includes('replace-with')) {
    fail('LIVE_SMOKE_ENV_INVALID', name + ' must be configured');
  }
  return value;
};

const normalizeBaseUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(
      'LIVE_SMOKE_BASE_URL_INVALID',
      'CLOUDINARY_LIVE_SMOKE_MEDIA_BASE_URL must be an absolute URL',
    );
  }
  const loopback =
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost' ||
    url.hostname === '::1';
  assertCondition(
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback),
    'LIVE_SMOKE_BASE_URL_INVALID',
    'The Media base URL must use HTTPS unless it is loopback',
  );
  assertCondition(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/' || url.pathname === ''),
    'LIVE_SMOKE_BASE_URL_INVALID',
    'The Media base URL must contain only an origin',
  );
  return url.origin;
};

const validateLiveEnvironment = (environment) => {
  if (String(environment.CLOUDINARY_LIVE_SMOKE ?? '').trim() !== '1') {
    fail(
      'LIVE_SMOKE_NOT_ENABLED',
      'CLOUDINARY_LIVE_SMOKE must equal 1',
    );
  }

  const cloudName = requiredEnvironment(
    environment,
    'CLOUDINARY_CLOUD_NAME',
  );
  const confirmation = requiredEnvironment(
    environment,
    'CLOUDINARY_LIVE_SMOKE_CONFIRM_CLOUD',
  );
  assertCondition(
    confirmation === cloudName,
    'LIVE_SMOKE_CLOUD_CONFIRMATION_MISMATCH',
    'The explicit smoke cloud confirmation does not match the configured cloud',
  );

  const internalKeys = {};
  for (const name of [
    'INTERNAL_API_KEY_PROFILE',
    'INTERNAL_API_KEY_COMPANY',
    'INTERNAL_API_KEY_CHAT',
  ]) {
    const value = requiredEnvironment(environment, name);
    assertCondition(
      Buffer.byteLength(value, 'utf8') >= 32,
      'LIVE_SMOKE_ENV_INVALID',
      name + ' must contain at least 32 bytes',
    );
    internalKeys[name] = value;
  }

  requiredEnvironment(environment, 'CLOUDINARY_API_KEY');
  requiredEnvironment(environment, 'CLOUDINARY_API_SECRET');
  for (const name of [
    'CLOUDINARY_LIVE_SMOKE_PDF_PATH',
    'CLOUDINARY_LIVE_SMOKE_IMAGE_PATH',
    'CLOUDINARY_LIVE_SMOKE_VIDEO_PATH',
  ]) {
    requiredEnvironment(environment, name);
  }

  return {
    environment,
    cloudName,
    baseUrl: normalizeBaseUrl(
      requiredEnvironment(
        environment,
        'CLOUDINARY_LIVE_SMOKE_MEDIA_BASE_URL',
      ),
    ),
    internalKeys,
  };
};

const normalizeFormat = (value) =>
  String(value).trim().toLowerCase() === 'jpeg'
    ? 'jpg'
    : String(value).trim().toLowerCase();

const buildSmokeCases = (
  policies,
  configuration,
  uuidFactory = randomUUID,
) => {
  const values = Object.values(policies);
  const policyTypes = new Set(
    values.map((policy) => policy.mediaType),
  );
  assertCondition(
    values.length === EXPECTED_MEDIA_TYPES.length &&
      EXPECTED_MEDIA_TYPES.every((type) => policyTypes.has(type)),
    'LIVE_SMOKE_POLICY_SET_INVALID',
    'MEDIA_POLICIES must contain exactly the six supported smoke types',
  );

  const cases = EXPECTED_MEDIA_TYPES.map((type, index) => {
    const policy = values.find((candidate) => candidate.mediaType === type);
    const route = ROUTES[type];
    const fixturePath = requiredEnvironment(
      configuration.environment,
      route.fixtureName,
    );
    const originalFilename = basename(fixturePath);
    const extension = normalizeFormat(extname(originalFilename).slice(1));
    assertCondition(
      originalFilename.length > 0 &&
        originalFilename.length <= 255 &&
        policy.formats.includes(extension),
      'LIVE_SMOKE_FIXTURE_INVALID',
      route.fixtureName + ' has an extension outside the media policy',
    );

    return {
      type,
      policy,
      service: route.service,
      ownerType: route.ownerType,
      ownerId: uuidFactory(),
      requestedBy: uuidFactory(),
      internalKey: configuration.internalKeys[route.keyName],
      fixturePath,
      fixtureFormat: extension,
      originalFilename,
      uploadPreset: requiredEnvironment(
        configuration.environment,
        policy.presetEnvironment,
      ),
      idempotencyKey:
        'cloudinary-smoke-' + String(index + 1) + '-' + uuidFactory(),
    };
  });

  assertCondition(
    new Set(cases.map((entry) => entry.uploadPreset)).size ===
      EXPECTED_MEDIA_TYPES.length,
    'LIVE_SMOKE_PRESET_SET_INVALID',
    'The six media policies must use six distinct upload presets',
  );
  return cases;
};

const assertFixtureMagic = (format, buffer) => {
  let valid = false;
  if (format === 'pdf') {
    valid = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  } else if (format === 'png') {
    valid = buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  } else if (format === 'jpg') {
    valid =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
  } else if (format === 'webp') {
    valid =
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  } else if (format === 'mp4') {
    valid = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  assertCondition(
    valid,
    'LIVE_SMOKE_FIXTURE_INVALID',
    'A live smoke fixture does not match its filename format',
  );
};

const mimeForFormat = (format) => ({
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
})[format] ?? 'application/octet-stream';

const createFixtureLoader = () => {
  const cache = new Map();
  return async (smokeCase) => {
    if (cache.has(smokeCase.fixturePath)) {
      const cached = cache.get(smokeCase.fixturePath);
      assertCondition(
        cached.bytes.length > 0 &&
          cached.bytes.length <= smokeCase.policy.maxBytes,
        'LIVE_SMOKE_FIXTURE_INVALID',
        'A cached live smoke fixture is outside policy size',
      );
      assertFixtureMagic(smokeCase.fixtureFormat, cached.bytes);
      return cached;
    }
    const fixtureStat = await stat(smokeCase.fixturePath).catch(() => null);
    assertCondition(
      fixtureStat?.isFile() &&
        fixtureStat.size > 0 &&
        fixtureStat.size <= smokeCase.policy.maxBytes,
      'LIVE_SMOKE_FIXTURE_INVALID',
      'A live smoke fixture must be a non-empty regular file within policy size',
    );
    const bytes = await readFile(smokeCase.fixturePath);
    assertCondition(
      bytes.length > 0 && bytes.length <= smokeCase.policy.maxBytes,
      'LIVE_SMOKE_FIXTURE_INVALID',
      'A live smoke fixture changed outside policy size while reading',
    );
    assertFixtureMagic(smokeCase.fixtureFormat, bytes);
    const fixture = {
      bytes,
      contentType: mimeForFormat(smokeCase.fixtureFormat),
    };
    cache.set(smokeCase.fixturePath, fixture);
    return fixture;
  };
};

const normalizePresetFormats = (value) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;
  if (raw === null) {
    return null;
  }
  return [...new Set(raw.map(normalizeFormat).filter(Boolean))].sort();
};

const validatePresetConfiguration = (smokeCase, response) => {
  assertCondition(
    typeof response === 'object' && response !== null,
    'LIVE_SMOKE_PRESET_INVALID',
    'Cloudinary returned an invalid upload preset response',
  );
  assertCondition(
    response.name === smokeCase.uploadPreset,
    'LIVE_SMOKE_PRESET_INVALID',
    'Cloudinary returned the wrong upload preset',
  );
  assertCondition(
    response.unsigned === false,
    'LIVE_SMOKE_PRESET_INVALID',
    'The upload preset must explicitly report signed mode',
  );

  const actualFormats = normalizePresetFormats(response.allowed_formats);
  const expectedFormats = [...smokeCase.policy.formats]
    .map(normalizeFormat)
    .sort();
  assertCondition(
    actualFormats !== null &&
      JSON.stringify(actualFormats) === JSON.stringify(expectedFormats),
    'LIVE_SMOKE_PRESET_INVALID',
    'The upload preset allowed_formats does not exactly match policy',
  );
  assertCondition(
    Number.isSafeInteger(response.max_file_size) &&
      response.max_file_size === smokeCase.policy.maxBytes,
    'LIVE_SMOKE_PRESET_INVALID',
    'The upload preset max_file_size does not exactly match policy',
  );
  assertCondition(
    typeof response.type === 'string' &&
      response.type.toLowerCase() ===
        DELIVERY_VALUES[smokeCase.policy.deliveryType],
    'LIVE_SMOKE_PRESET_INVALID',
    'The upload preset delivery type does not exactly match policy',
  );
};

const auditPresets = async (cases, admin) => {
  for (const smokeCase of cases) {
    const response = await admin.getUploadPreset(
      smokeCase.uploadPreset,
    );
    validatePresetConfiguration(smokeCase, response);
  }
};

const readLimitedText = async (response) => {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      length += next.value.length;
      if (length > MAX_JSON_BYTES) {
        await reader.cancel();
        fail(
          'LIVE_SMOKE_RESPONSE_TOO_LARGE',
          'A remote JSON response exceeded the smoke limit',
        );
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
};

const parseJsonResponse = async (response) => {
  const text = await readLimitedText(response);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(
      'LIVE_SMOKE_RESPONSE_INVALID',
      'A remote endpoint returned invalid JSON',
    );
  }
};

const safeRemoteCode = (payload) =>
  typeof payload?.code === 'string' &&
  /^[A-Z][A-Z0-9_]{0,63}$/.test(payload.code)
    ? payload.code
    : 'REMOTE_ERROR';

const timeoutSignal = (timeoutMs, signal) => {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

const createMediaClient = (configuration, signal) => {
  const request = async (
    smokeCase,
    method,
    path,
    body,
    expectedStatus,
  ) => {
    const response = await fetch(
      new URL(path, configuration.baseUrl + '/'),
      {
        method,
        headers: {
          accept: 'application/json',
          'x-internal-service': smokeCase.service,
          'x-internal-api-key': smokeCase.internalKey,
          ...(body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...(path === 'internal/signature'
            ? { 'idempotency-key': smokeCase.idempotencyKey }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: timeoutSignal(DEFAULT_HTTP_TIMEOUT_MS, signal),
      },
    );
    const payload = await parseJsonResponse(response);
    if (response.status !== expectedStatus) {
      fail(
        'LIVE_SMOKE_MEDIA_' + safeRemoteCode(payload),
        'Media Service rejected a live smoke request',
      );
    }
    assertCondition(
      typeof payload?.data === 'object' && payload.data !== null,
      'LIVE_SMOKE_RESPONSE_INVALID',
      'Media Service returned an invalid success envelope',
    );
    return payload.data;
  };

  return {
    createIntent: (smokeCase) =>
      request(
        smokeCase,
        'POST',
        'internal/signature',
        {
          type: smokeCase.type,
          ownerType: smokeCase.ownerType,
          ownerId: smokeCase.ownerId,
          requestedBy: smokeCase.requestedBy,
          originalFilename: smokeCase.originalFilename,
        },
        201,
      ),
    confirm: (smokeCase, fileId) =>
      request(
        smokeCase,
        'POST',
        'internal/confirm',
        { fileId },
        200,
      ),
    verify: (smokeCase, fileId) =>
      request(
        smokeCase,
        'POST',
        'internal/verify',
        {
          fileId,
          expectedOwnerType: smokeCase.ownerType,
          expectedOwnerId: smokeCase.ownerId,
          expectedType: smokeCase.type,
        },
        200,
      ),
    createDownload: (smokeCase, fileId) =>
      request(
        smokeCase,
        'POST',
        'internal/download-url',
        {
          fileId,
          expectedOwnerType: smokeCase.ownerType,
          expectedOwnerId: smokeCase.ownerId,
          expectedType: smokeCase.type,
        },
        200,
      ),
    deleteFile: (smokeCase, fileId) =>
      request(
        smokeCase,
        'DELETE',
        'internal/files/' + encodeURIComponent(fileId),
        undefined,
        200,
      ),
  };
};

const assertCapability = (
  smokeCase,
  capability,
  configuration,
) => {
  assertCondition(
    typeof capability.fileId === 'string' &&
      capability.cloudName === configuration.cloudName &&
      capability.resourceType ===
        RESOURCE_VALUES[smokeCase.policy.resourceType] &&
      typeof capability.signature === 'string' &&
      capability.signature.length > 0 &&
      capability.apiKey === requiredEnvironment(
        configuration.environment,
        'CLOUDINARY_API_KEY',
      ) &&
      typeof capability.params === 'object' &&
      capability.params !== null,
    'LIVE_SMOKE_CAPABILITY_INVALID',
    'Media Service returned an invalid upload capability',
  );
  const expectedUploadPublicId =
    capability.fileId +
    (smokeCase.policy.resourceType === 'RAW'
      ? '.' + smokeCase.fixtureFormat
      : '');
  let uploadUrl;
  try {
    uploadUrl = new URL(capability.uploadUrl);
  } catch {
    fail(
      'LIVE_SMOKE_CAPABILITY_INVALID',
      'Media Service returned an invalid upload endpoint',
    );
  }
  const expectedResource =
    RESOURCE_VALUES[smokeCase.policy.resourceType];
  assertCondition(
    uploadUrl.protocol === 'https:' &&
      !uploadUrl.username &&
      !uploadUrl.password &&
      !uploadUrl.search &&
      !uploadUrl.hash &&
      uploadUrl.hostname === 'api.cloudinary.com' &&
      uploadUrl.pathname === '/v1_1/' +
        encodeURIComponent(configuration.cloudName) + '/' +
        expectedResource + '/upload',
    'LIVE_SMOKE_CAPABILITY_INVALID',
    'The upload capability targets an unexpected endpoint',
  );
  assertCondition(
    Array.isArray(capability.allowedFormats) &&
      capability.allowedFormats.length === 1 &&
      capability.allowedFormats[0] === smokeCase.fixtureFormat &&
      capability.maxBytes === smokeCase.policy.maxBytes &&
      new Date(capability.expiresAt).getTime() > Date.now() &&
      Number.isSafeInteger(capability.params.timestamp) &&
      capability.params.timestamp > 0 &&
      capability.params.allowed_formats === smokeCase.fixtureFormat &&
      capability.params.context === 'file_id=' + capability.fileId &&
      capability.params.folder === smokeCase.policy.folder &&
      capability.params.public_id === expectedUploadPublicId &&
      capability.params.overwrite === 'false' &&
      capability.params.unique_filename === 'false' &&
      capability.params.use_filename === 'false' &&
      capability.params.type ===
        DELIVERY_VALUES[smokeCase.policy.deliveryType] &&
      capability.params.upload_preset === smokeCase.uploadPreset,
    'LIVE_SMOKE_CAPABILITY_INVALID',
    'The upload capability does not match the media policy',
  );
};

const uploadFixture = async (
  smokeCase,
  capability,
  fixture,
  configuration,
  signal,
) => {
  assertCapability(smokeCase, capability, configuration);
  const form = new FormData();
  form.append(
    'file',
    new Blob([fixture.bytes], { type: fixture.contentType }),
    smokeCase.originalFilename,
  );
  for (const [name, value] of Object.entries(capability.params)) {
    form.append(name, String(value));
  }
  form.append('api_key', capability.apiKey);
  form.append('signature', capability.signature);

  const response = await fetch(capability.uploadUrl, {
    method: 'POST',
    body: form,
    redirect: 'error',
    signal: timeoutSignal(DEFAULT_HTTP_TIMEOUT_MS, signal),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    fail(
      'LIVE_SMOKE_UPLOAD_REJECTED',
      'Cloudinary rejected a live smoke upload',
    );
  }

  const expectedPublicId =
    capability.params.folder + '/' + capability.params.public_id;
  const expectedResource = RESOURCE_VALUES[smokeCase.policy.resourceType];
  const expectedDelivery = DELIVERY_VALUES[smokeCase.policy.deliveryType];
  assertCondition(
    typeof payload?.asset_id === 'string' &&
      payload.asset_id.length > 0 &&
      payload.public_id === expectedPublicId &&
      payload.resource_type === expectedResource &&
      payload.type === expectedDelivery &&
      normalizeFormat(payload.format) === smokeCase.fixtureFormat &&
      Number.isSafeInteger(payload.bytes) &&
      payload.bytes > 0 &&
      payload.bytes <= smokeCase.policy.maxBytes,
    'LIVE_SMOKE_UPLOAD_MISMATCH',
    'Cloudinary upload metadata does not match the signed intent',
  );
  return {
    bytes: payload.bytes,
    locator: {
      publicId: payload.public_id,
      resourceType: smokeCase.policy.resourceType,
      deliveryType: smokeCase.policy.deliveryType,
      expectedFormat: smokeCase.fixtureFormat,
      contextFileId: capability.fileId,
      expectedAssetId: payload.asset_id,
    },
  };
};

const assertActiveMetadata = (
  smokeCase,
  fileId,
  metadata,
  uploaded,
) => {
  const privateDelivery =
    smokeCase.policy.deliveryType === 'AUTHENTICATED';
  assertCondition(
    metadata.id === fileId &&
      metadata.ownerType === smokeCase.ownerType &&
      metadata.ownerId === smokeCase.ownerId &&
      metadata.type === smokeCase.type &&
      metadata.status === 'ACTIVE' &&
      metadata.format === smokeCase.fixtureFormat &&
      metadata.bytes === uploaded.bytes &&
      metadata.privateDelivery === privateDelivery &&
      (privateDelivery
        ? metadata.url === null
        : typeof metadata.url === 'string'),
    'LIVE_SMOKE_METADATA_MISMATCH',
    'Media active metadata does not match the smoke upload',
  );
};

const validateAccessUrl = (
  value,
  configuration,
  privateDelivery,
) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(
      'LIVE_SMOKE_ACCESS_INVALID',
      'Media Service returned an invalid access URL',
    );
  }
  const allowedPrivateHosts = new Set([
    'api.cloudinary.com',
    'res.cloudinary.com',
  ]);
  const expectedPathPrefix =
    url.hostname === 'api.cloudinary.com'
      ? '/v1_1/' + encodeURIComponent(configuration.cloudName) + '/'
      : '/' + configuration.cloudName + '/';
  assertCondition(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (privateDelivery
        ? allowedPrivateHosts.has(url.hostname)
        : url.hostname === 'res.cloudinary.com') &&
      url.pathname.startsWith(expectedPathPrefix),
    'LIVE_SMOKE_ACCESS_INVALID',
    'Media Service returned an access URL outside the Cloudinary allowlist',
  );
  return url;
};

const probeAccess = async (
  smokeCase,
  fileId,
  metadata,
  configuration,
  media,
  signal,
) => {
  const privateDelivery =
    smokeCase.policy.deliveryType === 'AUTHENTICATED';
  let value = metadata.url;
  if (privateDelivery) {
    const download = await media.createDownload(smokeCase, fileId);
    assertCondition(
      typeof download.url === 'string' &&
        typeof download.expiresAt === 'string' &&
        Number.isFinite(new Date(download.expiresAt).getTime()) &&
        new Date(download.expiresAt).getTime() > Date.now(),
      'LIVE_SMOKE_ACCESS_INVALID',
      'Media Service returned an invalid private download capability',
    );
    value = download.url;
  }
  const url = validateAccessUrl(
    value,
    configuration,
    privateDelivery,
  );
  const response = await fetch(url, {
    method: 'GET',
    headers: { range: 'bytes=0-0' },
    redirect: 'error',
    signal: timeoutSignal(DEFAULT_HTTP_TIMEOUT_MS, signal),
  });
  assertCondition(
    response.status === 200 || response.status === 206,
    'LIVE_SMOKE_ACCESS_FAILED',
    'A Cloudinary smoke asset was not accessible',
  );
  if (response.body) {
    await response.body.cancel();
  }
};

const createLiveDependencies = (configuration, signal) => {
  cloudinary.config({
    cloud_name: configuration.cloudName,
    api_key: requiredEnvironment(
      configuration.environment,
      'CLOUDINARY_API_KEY',
    ),
    api_secret: requiredEnvironment(
      configuration.environment,
      'CLOUDINARY_API_SECRET',
    ),
    secure: true,
    signature_algorithm: 'sha256',
  });
  const storage = new CloudinaryStorageProvider(
    new ConfigService(configuration.environment),
  );
  const media = createMediaClient(configuration, signal);

  return {
    admin: {
      getUploadPreset: (name) =>
        cloudinary.api.upload_preset(name, {
          timeout: DEFAULT_HTTP_TIMEOUT_MS,
        }),
    },
    media,
    loadFixture: createFixtureLoader(),
    upload: (smokeCase, capability, fixture) =>
      uploadFixture(
        smokeCase,
        capability,
        fixture,
        configuration,
        signal,
      ),
    access: (smokeCase, fileId, metadata) =>
      probeAccess(
        smokeCase,
        fileId,
        metadata,
        configuration,
        media,
        signal,
      ),
    cleanup: async (smokeCase, fileId, uploaded) => {
      const errors = [];
      try {
        const deleted = await media.deleteFile(smokeCase, fileId);
        assertCondition(
          deleted.id === fileId && deleted.status === 'DELETED',
          'LIVE_SMOKE_CLEANUP_FAILED',
          'Media Service did not confirm exact file deletion',
        );
      } catch (error) {
        errors.push(error);
      }
      if (uploaded?.locator) {
        try {
          await storage.deleteAsset(uploaded.locator, {
            timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
          });
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await storage.reconcileIntentAssets(fileId, null, {
          timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
        });
        const verified = await storage.reconcileIntentAssets(
          fileId,
          null,
          { timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS },
        );
        assertCondition(
          verified.observedAssets === 0,
          'LIVE_SMOKE_CLEANUP_FAILED',
          'Cloudinary context cleanup did not become empty',
        );
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          'Exact live smoke cleanup failed',
        );
      }
    },
  };
};

const runSmokeCase = async (
  smokeCase,
  dependencies,
) => {
  let fileId;
  let uploaded;
  let primaryError;
  let result;
  try {
    const fixture = await dependencies.loadFixture(smokeCase);
    const capability = await dependencies.media.createIntent(smokeCase);
    assertCondition(
      typeof capability?.fileId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          capability.fileId,
        ),
      'LIVE_SMOKE_CAPABILITY_INVALID',
      'Media Service returned an invalid file ID',
    );
    fileId = capability.fileId;
    uploaded = await dependencies.upload(
      smokeCase,
      capability,
      fixture,
    );
    const confirmed = await dependencies.media.confirm(
      smokeCase,
      fileId,
    );
    assertActiveMetadata(
      smokeCase,
      fileId,
      confirmed,
      uploaded,
    );
    const verified = await dependencies.media.verify(
      smokeCase,
      fileId,
    );
    assertActiveMetadata(
      smokeCase,
      fileId,
      verified,
      uploaded,
    );
    await dependencies.access(
      smokeCase,
      fileId,
      verified,
    );
    const deleted = await dependencies.media.deleteFile(
      smokeCase,
      fileId,
    );
    assertCondition(
      deleted.id === fileId && deleted.status === 'DELETED',
      'LIVE_SMOKE_CLEANUP_FAILED',
      'Media Service did not complete exact file deletion',
    );
    result = { type: smokeCase.type, status: 'PASS' };
  } catch (error) {
    primaryError = error;
  }

  let cleanupError;
  if (fileId) {
    try {
      await dependencies.cleanup(smokeCase, fileId, uploaded);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Live smoke case and exact cleanup both failed',
    );
  }
  if (primaryError) {
    throw primaryError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  return result;
};

const runSmoke = async ({
  environment = process.env,
  policies = MEDIA_POLICIES,
  dependencies,
  uuidFactory = randomUUID,
  signal,
  logger = console,
} = {}) => {
  const configuration = validateLiveEnvironment(environment);
  const cases = buildSmokeCases(
    policies,
    configuration,
    uuidFactory,
  );
  const liveDependencies =
    dependencies ?? createLiveDependencies(configuration, signal);

  for (const smokeCase of cases) {
    await liveDependencies.loadFixture(smokeCase);
  }
  await auditPresets(cases, liveDependencies.admin);

  const results = [];
  for (const smokeCase of cases) {
    if (signal?.aborted) {
      fail(
        'LIVE_SMOKE_CANCELLED',
        'The live Cloudinary smoke was cancelled',
      );
    }
    logger.info('Cloudinary live smoke ' + smokeCase.type + ': START');
    results.push(
      await runSmokeCase(smokeCase, liveDependencies),
    );
    logger.info('Cloudinary live smoke ' + smokeCase.type + ': PASS');
  }
  return results;
};

const safeFailureCode = (error) => {
  if (error instanceof LiveSmokeError) {
    return error.code;
  }
  if (error instanceof AggregateError) {
    return 'LIVE_SMOKE_AGGREGATE_FAILURE';
  }
  return 'LIVE_SMOKE_UNEXPECTED_FAILURE';
};

const main = async () => {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const results = await runSmoke({ signal: controller.signal });
    console.info(
      'Cloudinary live smoke completed: ' +
        results.length +
        '/6 cases passed and cleaned',
    );
  } catch (error) {
    console.error(
      'Cloudinary live smoke failed: ' + safeFailureCode(error),
    );
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
};

module.exports = {
  EXPECTED_MEDIA_TYPES,
  LiveSmokeError,
  assertActiveMetadata,
  assertCapability,
  assertFixtureMagic,
  auditPresets,
  buildSmokeCases,
  createFixtureLoader,
  normalizePresetFormats,
  runSmoke,
  runSmokeCase,
  safeFailureCode,
  validateAccessUrl,
  validateLiveEnvironment,
  validatePresetConfiguration,
};

if (require.main === module) {
  void main();
}
