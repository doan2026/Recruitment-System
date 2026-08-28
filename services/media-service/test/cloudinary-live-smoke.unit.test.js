'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  MEDIA_POLICIES,
} = require('../dist/media/media-policy');
const {
  EXPECTED_MEDIA_TYPES,
  LiveSmokeError,
  assertFixtureMagic,
  buildSmokeCases,
  runSmoke,
  runSmokeCase,
  safeFailureCode,
  validateLiveEnvironment,
  validatePresetConfiguration,
} = require('../scripts/cloudinary-live-smoke');

const INTERNAL_KEY = '0123456789abcdef0123456789abcdef';

const environment = (overrides = {}) => ({
  CLOUDINARY_LIVE_SMOKE: '1',
  CLOUDINARY_LIVE_SMOKE_CONFIRM_CLOUD: 'staging-cloud',
  CLOUDINARY_LIVE_SMOKE_MEDIA_BASE_URL:
    'https://media.staging.example',
  CLOUDINARY_LIVE_SMOKE_PDF_PATH: '/fixtures/smoke.pdf',
  CLOUDINARY_LIVE_SMOKE_IMAGE_PATH: '/fixtures/smoke.png',
  CLOUDINARY_LIVE_SMOKE_VIDEO_PATH: '/fixtures/smoke.mp4',
  CLOUDINARY_CLOUD_NAME: 'staging-cloud',
  CLOUDINARY_API_KEY: 'staging-api-key',
  CLOUDINARY_API_SECRET: 'staging-api-secret',
  CLOUDINARY_UPLOAD_PRESET_CV: 'staging-cv',
  CLOUDINARY_UPLOAD_PRESET_AVATAR: 'staging-avatar',
  CLOUDINARY_UPLOAD_PRESET_COMPANY_LOGO: 'staging-company-logo',
  CLOUDINARY_UPLOAD_PRESET_COMPANY_IMAGE: 'staging-company-image',
  CLOUDINARY_UPLOAD_PRESET_COMPANY_VIDEO: 'staging-company-video',
  CLOUDINARY_UPLOAD_PRESET_CHAT_ATTACHMENT: 'staging-chat',
  INTERNAL_API_KEY_PROFILE: 'profile-' + INTERNAL_KEY,
  INTERNAL_API_KEY_COMPANY: 'company-' + INTERNAL_KEY,
  INTERNAL_API_KEY_CHAT: 'chat-' + INTERNAL_KEY,
  ...overrides,
});

const configuredCases = (overrides = {}) => {
  const config = validateLiveEnvironment(environment(overrides));
  return buildSmokeCases(MEDIA_POLICIES, config, randomUUID);
};

const presetResponse = (smokeCase) => ({
  name: smokeCase.uploadPreset,
  unsigned: false,
  allowed_formats: [...smokeCase.policy.formats],
  max_file_size: smokeCase.policy.maxBytes,
  type:
    smokeCase.policy.deliveryType === 'AUTHENTICATED'
      ? 'authenticated'
      : 'upload',
});

test('live smoke environment is explicit, confirmed and secret-safe', () => {
  assert.throws(
    () =>
      validateLiveEnvironment(
        environment({ CLOUDINARY_LIVE_SMOKE: '0' }),
      ),
    (error) =>
      error instanceof LiveSmokeError &&
      error.code === 'LIVE_SMOKE_NOT_ENABLED',
  );

  const mismatched = environment({
    CLOUDINARY_LIVE_SMOKE_CONFIRM_CLOUD: 'another-cloud',
  });
  assert.throws(
    () => validateLiveEnvironment(mismatched),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_SMOKE_CLOUD_CONFIRMATION_MISMATCH',
      );
      assert.equal(
        error.message.includes(mismatched.CLOUDINARY_API_SECRET),
        false,
      );
      assert.equal(error.message.includes('another-cloud'), false);
      return true;
    },
  );

  assert.throws(
    () =>
      validateLiveEnvironment(
        environment({
          CLOUDINARY_LIVE_SMOKE_MEDIA_BASE_URL:
            'http://media.staging.example',
        }),
      ),
    (error) => error.code === 'LIVE_SMOKE_BASE_URL_INVALID',
  );
  assert.doesNotThrow(() =>
    validateLiveEnvironment(
      environment({
        CLOUDINARY_LIVE_SMOKE_MEDIA_BASE_URL:
          'http://127.0.0.1:3000',
      }),
    ),
  );
});

test('smoke cases are sourced from exactly six media policies', () => {
  const cases = configuredCases();
  assert.deepEqual(
    cases.map((entry) => entry.type),
    EXPECTED_MEDIA_TYPES,
  );
  assert.equal(new Set(cases.map((entry) => entry.uploadPreset)).size, 6);
  assert.deepEqual(
    cases.map((entry) => [
      entry.type,
      entry.policy.resourceType,
      entry.policy.deliveryType,
      entry.fixtureFormat,
      entry.service,
    ]),
    [
      ['CV', 'RAW', 'AUTHENTICATED', 'pdf', 'profile-service'],
      ['AVATAR', 'IMAGE', 'UPLOAD', 'png', 'profile-service'],
      [
        'COMPANY_LOGO',
        'IMAGE',
        'UPLOAD',
        'png',
        'company-service',
      ],
      [
        'COMPANY_IMAGE',
        'IMAGE',
        'UPLOAD',
        'png',
        'company-service',
      ],
      [
        'COMPANY_VIDEO',
        'VIDEO',
        'UPLOAD',
        'mp4',
        'company-service',
      ],
      [
        'CHAT_ATTACHMENT',
        'RAW',
        'AUTHENTICATED',
        'pdf',
        'chat-service',
      ],
    ],
  );

  const missing = { ...MEDIA_POLICIES };
  delete missing.CHAT_ATTACHMENT;
  const config = validateLiveEnvironment(environment());
  assert.throws(
    () => buildSmokeCases(missing, config),
    (error) => error.code === 'LIVE_SMOKE_POLICY_SET_INVALID',
  );
  assert.throws(
    () =>
      configuredCases({
        CLOUDINARY_UPLOAD_PRESET_CHAT_ATTACHMENT: 'staging-cv',
      }),
    (error) => error.code === 'LIVE_SMOKE_PRESET_SET_INVALID',
  );
});

test('fixture magic validation stays local and bounded by format', () => {
  assert.doesNotThrow(() =>
    assertFixtureMagic('pdf', Buffer.from('%PDF-1.7\n')),
  );
  assert.doesNotThrow(() =>
    assertFixtureMagic(
      'png',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
  );
  assert.doesNotThrow(() =>
    assertFixtureMagic(
      'jpg',
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    ),
  );
  assert.doesNotThrow(() =>
    assertFixtureMagic('webp', Buffer.from('RIFF0000WEBP')),
  );
  assert.doesNotThrow(() =>
    assertFixtureMagic('mp4', Buffer.from('0000ftypisom')),
  );
  assert.throws(
    () => assertFixtureMagic('pdf', Buffer.from('not a PDF')),
    (error) => error.code === 'LIVE_SMOKE_FIXTURE_INVALID',
  );
});

test('preset audit validates supported signed policy fields exactly', () => {
  const smokeCase = configuredCases()[0];
  assert.doesNotThrow(() =>
    validatePresetConfiguration(
      smokeCase,
      presetResponse(smokeCase),
    ),
  );

  for (const invalid of [
    { name: smokeCase.uploadPreset },
    { ...presetResponse(smokeCase), name: undefined },
    { ...presetResponse(smokeCase), unsigned: true },
    { ...presetResponse(smokeCase), allowed_formats: ['jpg'] },
    {
      ...presetResponse(smokeCase),
      max_file_size: smokeCase.policy.maxBytes - 1,
    },
    { ...presetResponse(smokeCase), type: 'upload' },
  ]) {
    assert.throws(
      () => validatePresetConfiguration(smokeCase, invalid),
      (error) => error.code === 'LIVE_SMOKE_PRESET_INVALID',
    );
  }
});

const activeMetadata = (smokeCase, fileId, bytes) => ({
  id: fileId,
  ownerType: smokeCase.ownerType,
  ownerId: smokeCase.ownerId,
  type: smokeCase.type,
  status: 'ACTIVE',
  format: smokeCase.fixtureFormat,
  bytes,
  privateDelivery:
    smokeCase.policy.deliveryType === 'AUTHENTICATED',
  url:
    smokeCase.policy.deliveryType === 'AUTHENTICATED'
      ? null
      : 'https://res.cloudinary.com/staging-cloud/safe',
});

const orchestrationDependencies = (events) => {
  const caseByPreset = new Map(
    configuredCases().map((entry) => [entry.uploadPreset, entry]),
  );
  const fileIds = new Map();
  let activeOperations = 0;
  let maximumOperations = 0;
  const operation = async (name, smokeCase, value) => {
    activeOperations += 1;
    maximumOperations = Math.max(maximumOperations, activeOperations);
    events.push(name + ':' + smokeCase.type);
    await Promise.resolve();
    activeOperations -= 1;
    return value;
  };

  return {
    maximumOperations: () => maximumOperations,
    admin: {
      getUploadPreset: async (name) => {
        const smokeCase = caseByPreset.get(name);
        events.push('preset:' + smokeCase.type);
        return presetResponse(smokeCase);
      },
    },
    loadFixture: (smokeCase) =>
      operation('fixture', smokeCase, {
        bytes: Buffer.from('fixture'),
        contentType: 'application/octet-stream',
      }),
    media: {
      createIntent: async (smokeCase) => {
        const fileId = randomUUID();
        fileIds.set(smokeCase.type, fileId);
        return operation('signature', smokeCase, { fileId });
      },
      confirm: (smokeCase, fileId) =>
        operation(
          'confirm',
          smokeCase,
          activeMetadata(smokeCase, fileId, 7),
        ),
      verify: (smokeCase, fileId) =>
        operation(
          'verify',
          smokeCase,
          activeMetadata(smokeCase, fileId, 7),
        ),
      deleteFile: (smokeCase, fileId) =>
        operation('delete', smokeCase, {
          id: fileId,
          status: 'DELETED',
        }),
    },
    upload: (smokeCase, capability) =>
      operation('upload', smokeCase, {
        bytes: 7,
        locator: {
          contextFileId: capability.fileId,
        },
      }),
    access: (smokeCase) =>
      operation('access', smokeCase, undefined),
    cleanup: (smokeCase) =>
      operation('cleanup', smokeCase, undefined),
    fileIds,
  };
};

test('offline orchestration audits first and runs six cases sequentially', async () => {
  const events = [];
  const dependencies = orchestrationDependencies(events);
  const logs = [];
  const results = await runSmoke({
    environment: environment(),
    dependencies,
    logger: { info: (message) => logs.push(message) },
  });

  assert.deepEqual(
    results,
    EXPECTED_MEDIA_TYPES.map((type) => ({ type, status: 'PASS' })),
  );
  const firstSignature = events.findIndex((value) =>
    value.startsWith('signature:'),
  );
  assert.equal(
    events.slice(0, firstSignature).filter((value) =>
      value.startsWith('preset:'),
    ).length,
    6,
  );
  for (const type of EXPECTED_MEDIA_TYPES) {
    const sequence = events.filter((value) =>
      value.endsWith(':' + type),
    );
    assert.deepEqual(sequence.slice(-7), [
      'fixture:' + type,
      'signature:' + type,
      'upload:' + type,
      'confirm:' + type,
      'verify:' + type,
      'access:' + type,
      'delete:' + type,
      'cleanup:' + type,
    ].slice(-7));
  }
  assert.equal(dependencies.maximumOperations(), 1);
  assert.equal(
    logs.some((message) =>
      message.includes(environment().CLOUDINARY_API_SECRET),
    ),
    false,
  );
  assert.equal(
    logs.some((message) => message.includes('https://')),
    false,
  );
});

test('case failure still performs exact cleanup and preserves both errors', async () => {
  const smokeCase = configuredCases()[0];
  const cleaned = [];
  const uploadFailure = new LiveSmokeError(
    'LIVE_SMOKE_UPLOAD_REJECTED',
    'upload rejected',
  );
  const baseDependencies = {
    loadFixture: async () => ({ bytes: Buffer.from('fixture') }),
    media: {
      createIntent: async () => ({ fileId: randomUUID() }),
      confirm: async () => assert.fail('confirm must not run'),
      verify: async () => assert.fail('verify must not run'),
      deleteFile: async () => assert.fail('delete must not run'),
    },
    upload: async () => {
      throw uploadFailure;
    },
    access: async () => assert.fail('access must not run'),
    cleanup: async (_case, fileId) => cleaned.push(fileId),
  };

  await assert.rejects(
    () => runSmokeCase(smokeCase, baseDependencies),
    (error) => error === uploadFailure,
  );
  assert.equal(cleaned.length, 1);

  await assert.rejects(
    () =>
      runSmokeCase(smokeCase, {
        ...baseDependencies,
        cleanup: async () => {
          throw new LiveSmokeError(
            'LIVE_SMOKE_CLEANUP_FAILED',
            'cleanup failed',
          );
        },
      }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.equal(
        safeFailureCode(error),
        'LIVE_SMOKE_AGGREGATE_FAILURE',
      );
      return true;
    },
  );
});

test('upload, confirm and access failures always clean the exact intent', async () => {
  const smokeCase = configuredCases()[0];
  for (const failedStage of ['upload', 'confirm', 'access']) {
    const fileId = randomUUID();
    const cleanupCalls = [];
    const failure = new LiveSmokeError(
      'LIVE_SMOKE_STAGE_FAILED',
      'stage failed',
    );
    const uploaded = {
      bytes: 7,
      locator: { contextFileId: fileId },
    };
    const dependencies = {
      loadFixture: async () => ({ bytes: Buffer.from('fixture') }),
      media: {
        createIntent: async () => ({ fileId }),
        confirm: async () => {
          if (failedStage === 'confirm') {
            throw failure;
          }
          return activeMetadata(smokeCase, fileId, 7);
        },
        verify: async () => activeMetadata(smokeCase, fileId, 7),
        deleteFile: async () => ({ id: fileId, status: 'DELETED' }),
      },
      upload: async () => {
        if (failedStage === 'upload') {
          throw failure;
        }
        return uploaded;
      },
      access: async () => {
        if (failedStage === 'access') {
          throw failure;
        }
      },
      cleanup: async (_case, cleanedFileId, cleanedUpload) => {
        cleanupCalls.push({ cleanedFileId, cleanedUpload });
      },
    };

    await assert.rejects(
      () => runSmokeCase(smokeCase, dependencies),
      (error) => error === failure,
    );
    assert.equal(cleanupCalls.length, 1);
    assert.equal(cleanupCalls[0].cleanedFileId, fileId);
    assert.equal(
      cleanupCalls[0].cleanedUpload,
      failedStage === 'upload' ? undefined : uploaded,
    );
  }
});

test('valid fileId is retained for cleanup when the remaining capability is invalid', async () => {
  const smokeCase = configuredCases()[0];
  const fileId = randomUUID();
  const cleanupCalls = [];
  await assert.rejects(
    () =>
      runSmokeCase(smokeCase, {
        loadFixture: async () => ({ bytes: Buffer.from('fixture') }),
        media: {
          createIntent: async () => ({ fileId }),
          confirm: async () => assert.fail('confirm must not run'),
          verify: async () => assert.fail('verify must not run'),
          deleteFile: async () => assert.fail('delete must not run'),
        },
        upload: async () => {
          throw new LiveSmokeError(
            'LIVE_SMOKE_CAPABILITY_INVALID',
            'capability invalid',
          );
        },
        access: async () => assert.fail('access must not run'),
        cleanup: async (_case, cleanedFileId) => {
          cleanupCalls.push(cleanedFileId);
        },
      }),
    (error) => error.code === 'LIVE_SMOKE_CAPABILITY_INVALID',
  );
  assert.deepEqual(cleanupCalls, [fileId]);
});

test('preset audit failure prevents every remote upload mutation', async () => {
  const events = [];
  const dependencies = orchestrationDependencies(events);
  dependencies.admin.getUploadPreset = async () => ({
    unsigned: true,
  });
  await assert.rejects(
    () =>
      runSmoke({
        environment: environment(),
        dependencies,
        logger: { info: () => {} },
      }),
    (error) => error.code === 'LIVE_SMOKE_PRESET_INVALID',
  );
  assert.equal(
    events.some((value) => value.startsWith('signature:')),
    false,
  );
});
