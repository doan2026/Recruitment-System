'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { HttpApplicationCvUsageClient } = require(
  '../dist/application/http-application-cv-usage.client',
);

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const CV_ID = '22222222-2222-4222-8222-222222222222';
const DELETION_REQUEST_ID =
  '33333333-3333-4333-8333-333333333333';
const INTERNAL_KEY = 'profile-application-test-key-000000000000';
const BASE_CONFIG = {
  APPLICATION_INTERNAL_API_KEY: INTERNAL_KEY,
  APPLICATION_REQUEST_TIMEOUT_MS: '3000',
  APPLICATION_SERVICE_URL: 'https://application.internal.example',
  INTERNAL_API_KEY_APPLICATION:
    'application-profile-test-key-000000000000',
};

const createConfig = (overrides = {}) => {
  const values = { ...BASE_CONFIG, ...overrides };
  return { get: (key) => values[key] };
};

const envelopeResponse = (data, init = {}) =>
  new Response(JSON.stringify({ data, meta: null }), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });

const unusedUsage = (overrides = {}) => ({
  applicationCount: 0,
  candidateId: CANDIDATE_ID,
  cvId: CV_ID,
  firstUsedAt: null,
  used: false,
  ...overrides,
});

const usedUsage = (overrides = {}) => ({
  applicationCount: 3,
  candidateId: CANDIDATE_ID,
  cvId: CV_ID,
  firstUsedAt: '2026-08-27T03:00:00.123456Z',
  used: true,
  ...overrides,
});

const fencedDeletion = (overrides = {}) => ({
  applicationCount: 0,
  candidateId: CANDIDATE_ID,
  cvId: CV_ID,
  deletionRequestId: DELETION_REQUEST_ID,
  disposition: 'FENCED',
  fencedAt: '2026-08-27T03:00:00.123456Z',
  firstUsedAt: null,
  ...overrides,
});

const usedDeletion = (overrides = {}) => ({
  applicationCount: 3,
  candidateId: CANDIDATE_ID,
  cvId: CV_ID,
  deletionRequestId: DELETION_REQUEST_ID,
  disposition: 'USED',
  fencedAt: null,
  firstUsedAt: '2026-08-27T03:00:00.123456Z',
  ...overrides,
});

const assertApiError = async (operation, status, code) => {
  await assert.rejects(operation, (error) => {
    assert.equal(error.getStatus?.(), status);
    const response = error.getResponse?.();
    assert.equal(response?.code, code);
    assert.equal(response?.details, null);
    return true;
  });
};

const withFetch = async (implementation, operation) => {
  const originalFetch = global.fetch;
  global.fetch = implementation;
  try {
    return await operation();
  } finally {
    global.fetch = originalFetch;
  }
};

test('Application usage client validates origin, key, and bounded timeout config', () => {
  assert.equal(
    new HttpApplicationCvUsageClient(
      createConfig({ APPLICATION_REQUEST_TIMEOUT_MS: undefined }),
    ).requestTimeoutMs,
    3000,
  );
  assert.equal(
    new HttpApplicationCvUsageClient(
      createConfig({
        APPLICATION_REQUEST_TIMEOUT_MS: '100',
        APPLICATION_SERVICE_URL: 'http://application-service:8080/',
      }),
    ).requestTimeoutMs,
    100,
  );
  assert.equal(
    new HttpApplicationCvUsageClient(
      createConfig({ APPLICATION_REQUEST_TIMEOUT_MS: '10000' }),
    ).requestTimeoutMs,
    10000,
  );

  const invalidOverrides = [
    { APPLICATION_SERVICE_URL: undefined },
    { APPLICATION_SERVICE_URL: 1234 },
    { APPLICATION_SERVICE_URL: 'ftp://application.example' },
    { APPLICATION_SERVICE_URL: 'https://user:key@application.example' },
    { APPLICATION_SERVICE_URL: 'https://application.example/internal' },
    { APPLICATION_SERVICE_URL: 'https://application.example?key=value' },
    { APPLICATION_SERVICE_URL: 'https://application.example#fragment' },
    { APPLICATION_INTERNAL_API_KEY: 'short' },
    { APPLICATION_INTERNAL_API_KEY: 1234 },
    { APPLICATION_INTERNAL_API_KEY: `${INTERNAL_KEY}\n` },
    {
      APPLICATION_INTERNAL_API_KEY:
        'replace-with-a-distinct-profile-to-application-key',
    },
    { INTERNAL_API_KEY_APPLICATION: undefined },
    { INTERNAL_API_KEY_APPLICATION: INTERNAL_KEY },
    { APPLICATION_REQUEST_TIMEOUT_MS: '99' },
    { APPLICATION_REQUEST_TIMEOUT_MS: '10001' },
    { APPLICATION_REQUEST_TIMEOUT_MS: '100.5' },
    { APPLICATION_REQUEST_TIMEOUT_MS: 3000 },
  ];
  for (const overrides of invalidOverrides) {
    assert.throws(
      () => new HttpApplicationCvUsageClient(createConfig(overrides)),
      (error) =>
        error.getStatus?.() === 503 &&
        error.getResponse?.().code ===
          'APPLICATION_SERVICE_CONFIGURATION_ERROR',
    );
  }
});

test('lookup sends exact identity, path, and canonical UUID body', async () => {
  const client = new HttpApplicationCvUsageClient(createConfig());
  const result = await withFetch(
    async (url, options) => {
      assert.equal(
        url,
        'https://application.internal.example/internal/v1/cv-usages/lookup',
      );
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.signal instanceof AbortSignal, true);
      assert.deepEqual(options.headers, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': INTERNAL_KEY,
        'X-Internal-Service': 'profile-service',
      });
      assert.deepEqual(JSON.parse(options.body), {
        candidateId: CANDIDATE_ID,
        cvId: CV_ID,
      });
      return envelopeResponse(unusedUsage());
    },
    () => client.lookup(CANDIDATE_ID.toUpperCase(), CV_ID.toUpperCase()),
  );
  assert.deepEqual(result, unusedUsage());
});

test('deletion fence sends the stable request identity and accepts the exact FENCED contract', async () => {
  const client = new HttpApplicationCvUsageClient(createConfig());
  const result = await withFetch(
    async (url, options) => {
      assert.equal(
        url,
        'https://application.internal.example/internal/v1/cv-deletion-fences/acquire',
      );
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': INTERNAL_KEY,
        'X-Internal-Service': 'profile-service',
      });
      assert.deepEqual(JSON.parse(options.body), {
        candidateId: CANDIDATE_ID,
        cvId: CV_ID,
        deletionRequestId: DELETION_REQUEST_ID,
      });
      return envelopeResponse(fencedDeletion());
    },
    () =>
      client.acquireDeletionFence(
        CANDIDATE_ID.toUpperCase(),
        CV_ID.toUpperCase(),
        DELETION_REQUEST_ID.toUpperCase(),
      ),
  );
  assert.deepEqual(result, fencedDeletion());
});

test('deletion fence validates UUIDv4 locally and fails closed on inconsistent decisions', async () => {
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return envelopeResponse(fencedDeletion());
    },
    () =>
      assertApiError(
        () =>
          new HttpApplicationCvUsageClient(
            createConfig(),
          ).acquireDeletionFence(
            CANDIDATE_ID,
            CV_ID,
            '33333333-3333-1333-8333-333333333333',
          ),
        422,
        'APPLICATION_CV_USAGE_REQUEST_INVALID',
      ),
  );
  assert.equal(called, false);

  const invalidPayloads = [
    fencedDeletion({ candidateId: CV_ID }),
    fencedDeletion({ cvId: CANDIDATE_ID }),
    fencedDeletion({ deletionRequestId: CANDIDATE_ID }),
    fencedDeletion({ disposition: 'USED' }),
    fencedDeletion({ applicationCount: 1 }),
    fencedDeletion({ fencedAt: null }),
    fencedDeletion({ firstUsedAt: '2026-08-27T03:00:00Z' }),
    usedDeletion({ applicationCount: 0 }),
    usedDeletion({ fencedAt: '2026-08-27T03:00:00Z' }),
    usedDeletion({ firstUsedAt: null }),
    { ...fencedDeletion(), unexpected: true },
  ];
  for (const payload of invalidPayloads) {
    await withFetch(
      async () => envelopeResponse(payload),
      () =>
        assertApiError(
          () =>
            new HttpApplicationCvUsageClient(
              createConfig(),
            ).acquireDeletionFence(
              CANDIDATE_ID,
              CV_ID,
              DELETION_REQUEST_ID,
            ),
          503,
          'APPLICATION_SERVICE_BAD_RESPONSE',
        ),
    );
  }
});

test('deletion fence accepts only HTTP 200 and treats a missing endpoint as unavailable', async () => {
  for (const status of [201, 204]) {
    await withFetch(
      async () =>
        status === 204
          ? new Response(null, { status })
          : envelopeResponse(fencedDeletion(), { status }),
      () =>
        assertApiError(
          () =>
            new HttpApplicationCvUsageClient(
              createConfig(),
            ).acquireDeletionFence(
              CANDIDATE_ID,
              CV_ID,
              DELETION_REQUEST_ID,
            ),
          503,
          'APPLICATION_SERVICE_BAD_RESPONSE',
        ),
    );
  }

  await withFetch(
    async () => new Response(null, { status: 404 }),
    () =>
      assertApiError(
        () =>
          new HttpApplicationCvUsageClient(
            createConfig(),
          ).acquireDeletionFence(
            CANDIDATE_ID,
            CV_ID,
            DELETION_REQUEST_ID,
          ),
        503,
        'APPLICATION_SERVICE_UNAVAILABLE',
      ),
  );
});

test('lookup validates UUIDv4 before any network call', async () => {
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return envelopeResponse(unusedUsage());
    },
    async () => {
      await assertApiError(
        () => client().lookup('11111111-1111-1111-8111-111111111111', CV_ID),
        422,
        'APPLICATION_CV_USAGE_REQUEST_INVALID',
      );
      await assertApiError(
        () => client().lookup(CANDIDATE_ID, 'not-a-uuid'),
        422,
        'APPLICATION_CV_USAGE_REQUEST_INVALID',
      );
    },
  );
  assert.equal(called, false);

  function client() {
    return new HttpApplicationCvUsageClient(createConfig());
  }
});

test('lookup accepts only an exact echoed and internally consistent usage state', async () => {
  const validUsed = await withFetch(
    async () => envelopeResponse(usedUsage()),
    () =>
      new HttpApplicationCvUsageClient(createConfig()).lookup(
        CANDIDATE_ID,
        CV_ID,
      ),
  );
  assert.deepEqual(validUsed, usedUsage());

  const invalidPayloads = [
    unusedUsage({ candidateId: CV_ID }),
    unusedUsage({ cvId: CANDIDATE_ID }),
    unusedUsage({ used: 'false' }),
    unusedUsage({ applicationCount: -1 }),
    unusedUsage({ applicationCount: 1 }),
    unusedUsage({ firstUsedAt: '2026-08-27T03:00:00Z' }),
    usedUsage({ applicationCount: 0 }),
    usedUsage({ firstUsedAt: null }),
    usedUsage({ firstUsedAt: '2026-02-30T03:00:00Z' }),
    usedUsage({ firstUsedAt: '2026-08-27 03:00:00Z' }),
    { ...unusedUsage(), unexpected: true },
  ];
  for (const payload of invalidPayloads) {
    await withFetch(
      async () => envelopeResponse(payload),
      () =>
        assertApiError(
          () =>
            new HttpApplicationCvUsageClient(createConfig()).lookup(
              CANDIDATE_ID,
              CV_ID,
            ),
          503,
          'APPLICATION_SERVICE_BAD_RESPONSE',
        ),
    );
  }
});

test('malformed, non-exact, and oversized envelopes fail closed', async () => {
  const malformedResponses = [
    () =>
      new Response('{not-json', {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(JSON.stringify({ data: unusedUsage(), meta: null }), {
        headers: { 'content-type': 'text/plain' },
      }),
    () =>
      new Response(JSON.stringify({ data: unusedUsage() }), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(JSON.stringify({ data: unusedUsage(), meta: {} }), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(
        JSON.stringify({ data: unusedUsage(), meta: null, extra: true }),
        { headers: { 'content-type': 'application/json' } },
      ),
    () =>
      new Response(
        JSON.stringify({
          data: unusedUsage(),
          meta: null,
          padding: 'x'.repeat(17 * 1024),
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  ];

  for (const responseFactory of malformedResponses) {
    await withFetch(
      async () => responseFactory(),
      () =>
        assertApiError(
          () =>
            new HttpApplicationCvUsageClient(createConfig()).lookup(
              CANDIDATE_ID,
              CV_ID,
            ),
          503,
          'APPLICATION_SERVICE_BAD_RESPONSE',
        ),
    );
  }
});

test('upstream statuses map to stable safe errors without trusting bodies', async () => {
  const cases = [
    [400, 409, 'APPLICATION_CV_USAGE_INVALID'],
    [401, 503, 'APPLICATION_SERVICE_AUTH_FAILED'],
    [403, 503, 'APPLICATION_SERVICE_AUTH_FAILED'],
    [404, 409, 'APPLICATION_CV_USAGE_INVALID'],
    [409, 409, 'APPLICATION_CV_USAGE_INVALID'],
    [422, 409, 'APPLICATION_CV_USAGE_INVALID'],
    [429, 503, 'APPLICATION_SERVICE_UNAVAILABLE'],
    [500, 503, 'APPLICATION_SERVICE_UNAVAILABLE'],
  ];

  for (const [upstream, expectedStatus, expectedCode] of cases) {
    await withFetch(
      async () =>
        new Response(
          JSON.stringify({
            code: 'SECRET_UPSTREAM_CODE',
            message: 'sensitive upstream details',
          }),
          {
            status: upstream,
            headers: { 'content-type': 'application/json' },
          },
        ),
      () =>
        assertApiError(
          () =>
            new HttpApplicationCvUsageClient(createConfig()).lookup(
              CANDIDATE_ID,
              CV_ID,
            ),
          expectedStatus,
          expectedCode,
        ),
    );
  }
});

test('network failure and timeout fail closed as service unavailable', async () => {
  await withFetch(
    async () => {
      throw new Error('private network detail');
    },
    () =>
      assertApiError(
        () =>
          new HttpApplicationCvUsageClient(createConfig()).lookup(
            CANDIDATE_ID,
            CV_ID,
          ),
        503,
        'APPLICATION_SERVICE_UNAVAILABLE',
      ),
  );

  const keepEventLoopAlive = setTimeout(() => undefined, 250);
  try {
    await withFetch(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true },
          );
        }),
      () =>
        assertApiError(
          () =>
            new HttpApplicationCvUsageClient(
              createConfig({ APPLICATION_REQUEST_TIMEOUT_MS: '100' }),
            ).lookup(CANDIDATE_ID, CV_ID),
          503,
          'APPLICATION_SERVICE_UNAVAILABLE',
        ),
    );
  } finally {
    clearTimeout(keepEventLoopAlive);
  }
});
