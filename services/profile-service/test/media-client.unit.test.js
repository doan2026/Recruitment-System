'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { HttpProfileMediaClient } = require(
  '../dist/media/http-profile-media.client',
);

const FILE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REFERENCE_ID = '33333333-3333-4333-8333-333333333333';
const INTERNAL_KEY = 'profile-media-test-key-0000000000000000';
const BASE_CONFIG = {
  MEDIA_INTERNAL_API_KEY: INTERNAL_KEY,
  MEDIA_REQUEST_TIMEOUT_MS: '3000',
  MEDIA_SERVICE_URL: 'https://media.internal.example',
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

const metadata = (type = 'AVATAR', overrides = {}) => ({
  aggregateVersion: 2,
  bytes: 1024,
  createdAt: '2026-08-27T03:00:00.000Z',
  format: type === 'CV' ? 'pdf' : 'png',
  id: FILE_ID,
  mimeType: type === 'CV' ? 'application/pdf' : 'image/png',
  originalFilename: type === 'CV' ? 'candidate.pdf' : 'avatar.png',
  ownerId: USER_ID,
  ownerType: 'USER',
  privateDelivery: type === 'CV',
  status: 'ACTIVE',
  type,
  updatedAt: '2026-08-27T03:01:00.000Z',
  url: type === 'CV' ? null : 'https://cdn.example/avatar.png',
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

test('Media client validates origin, key, and bounded timeout configuration', () => {
  const defaultTimeout = new HttpProfileMediaClient(
    createConfig({ MEDIA_REQUEST_TIMEOUT_MS: undefined }),
  );
  assert.equal(defaultTimeout.requestTimeoutMs, 3000);
  assert.equal(
    new HttpProfileMediaClient(
      createConfig({
        MEDIA_REQUEST_TIMEOUT_MS: '100',
        MEDIA_SERVICE_URL: 'http://media-service:3000/',
      }),
    ).requestTimeoutMs,
    100,
  );
  assert.equal(
    new HttpProfileMediaClient(
      createConfig({ MEDIA_REQUEST_TIMEOUT_MS: '10000' }),
    ).requestTimeoutMs,
    10000,
  );

  const invalidOverrides = [
    { MEDIA_SERVICE_URL: undefined },
    { MEDIA_SERVICE_URL: 1234 },
    { MEDIA_SERVICE_URL: 'ftp://media.example' },
    { MEDIA_SERVICE_URL: 'https://user:secret@media.example' },
    { MEDIA_SERVICE_URL: 'https://media.example/internal' },
    { MEDIA_SERVICE_URL: 'https://media.example?secret=value' },
    { MEDIA_SERVICE_URL: 'https://media.example#fragment' },
    { MEDIA_INTERNAL_API_KEY: 'short' },
    { MEDIA_INTERNAL_API_KEY: 1234 },
    {
      MEDIA_INTERNAL_API_KEY:
        'replace-with-a-distinct-profile-service-key',
    },
    { MEDIA_REQUEST_TIMEOUT_MS: '99' },
    { MEDIA_REQUEST_TIMEOUT_MS: '10001' },
    { MEDIA_REQUEST_TIMEOUT_MS: '100.5' },
    { MEDIA_REQUEST_TIMEOUT_MS: 3000 },
  ];
  for (const overrides of invalidOverrides) {
    assert.throws(
      () => new HttpProfileMediaClient(createConfig(overrides)),
      (error) =>
        error.getStatus?.() === 503 &&
        error.getResponse?.().code ===
          'MEDIA_SERVICE_CONFIGURATION_ERROR',
    );
  }
});

test('verify sends exact internal headers and expectation body', async () => {
  const expected = metadata('AVATAR');
  const client = new HttpProfileMediaClient(createConfig());
  const actual = await withFetch(
    async (url, options) => {
      assert.equal(url, 'https://media.internal.example/internal/verify');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': INTERNAL_KEY,
        'X-Internal-Service': 'profile-service',
      });
      assert.deepEqual(JSON.parse(options.body), {
        expectedOwnerId: USER_ID,
        expectedOwnerType: 'USER',
        expectedType: 'AVATAR',
        fileId: FILE_ID,
      });
      assert.equal(options.signal instanceof AbortSignal, true);
      return envelopeResponse(expected);
    },
    () => client.verifyUserFile(FILE_ID, USER_ID, 'AVATAR'),
  );
  assert.deepEqual(actual, expected);
});

test('verify enforces ACTIVE USER ownership and delivery invariants', async () => {
  const invalidPayloads = [
    metadata('AVATAR', { id: REFERENCE_ID }),
    metadata('AVATAR', { ownerId: REFERENCE_ID }),
    metadata('AVATAR', { ownerType: 'COMPANY' }),
    metadata('AVATAR', { status: 'PENDING' }),
    metadata('CV'),
    metadata('AVATAR', { privateDelivery: true, url: null }),
    metadata('AVATAR', { url: 'http://cdn.example/avatar.png' }),
    metadata('AVATAR', { createdAt: '0' }),
    metadata('CV', { privateDelivery: false }),
    { ...metadata('AVATAR'), unexpected: true },
  ];

  for (const payload of invalidPayloads) {
    const client = new HttpProfileMediaClient(createConfig());
    await withFetch(
      async () => envelopeResponse(payload),
      () =>
        assertApiError(
          () => client.verifyUserFile(FILE_ID, USER_ID, 'AVATAR'),
          503,
          'MEDIA_SERVICE_BAD_RESPONSE',
        ),
    );
  }

  const cv = metadata('CV');
  const validCv = await withFetch(
    async () => envelopeResponse(cv),
    () =>
      new HttpProfileMediaClient(createConfig()).verifyUserFile(
        FILE_ID,
        USER_ID,
        'CV',
      ),
  );
  assert.deepEqual(validCv, cv);
});

test('malformed and oversized success envelopes fail closed', async () => {
  const malformedResponses = [
    () =>
      new Response('{not-json', {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(JSON.stringify({ data: metadata(), meta: null }), {
        headers: { 'content-type': 'text/plain' },
      }),
    () =>
      new Response(JSON.stringify({ data: metadata() }), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(
        JSON.stringify({ data: metadata(), meta: null, extra: true }),
        { headers: { 'content-type': 'application/json' } },
      ),
    () =>
      new Response(
        JSON.stringify({
          data: metadata(),
          meta: null,
          padding: 'x'.repeat(70 * 1024),
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  ];

  for (const responseFactory of malformedResponses) {
    const client = new HttpProfileMediaClient(createConfig());
    await withFetch(
      async () => responseFactory(),
      () =>
        assertApiError(
          () => client.verifyUserFile(FILE_ID, USER_ID, 'AVATAR'),
          503,
          'MEDIA_SERVICE_BAD_RESPONSE',
        ),
    );
  }
});

test('upstream statuses map to stable safe errors without trusting its body', async () => {
  const cases = [
    [401, 503, 'MEDIA_SERVICE_AUTH_FAILED'],
    [403, 422, 'MEDIA_FILE_INVALID'],
    [404, 422, 'MEDIA_FILE_INVALID'],
    [409, 422, 'MEDIA_FILE_INVALID'],
    [410, 422, 'MEDIA_FILE_INVALID'],
    [422, 422, 'MEDIA_FILE_INVALID'],
    [429, 503, 'MEDIA_SERVICE_UNAVAILABLE'],
    [500, 503, 'MEDIA_SERVICE_UNAVAILABLE'],
  ];

  for (const [upstream, expectedStatus, expectedCode] of cases) {
    const client = new HttpProfileMediaClient(createConfig());
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
          () => client.verifyUserFile(FILE_ID, USER_ID, 'AVATAR'),
          expectedStatus,
          expectedCode,
        ),
    );
  }
});

test('network failure and request timeout map to service unavailable', async () => {
  const networkClient = new HttpProfileMediaClient(createConfig());
  await withFetch(
    async () => {
      throw new Error('private network detail');
    },
    () =>
      assertApiError(
        () => networkClient.verifyUserFile(FILE_ID, USER_ID, 'AVATAR'),
        503,
        'MEDIA_SERVICE_UNAVAILABLE',
      ),
  );

  const timeoutClient = new HttpProfileMediaClient(
    createConfig({ MEDIA_REQUEST_TIMEOUT_MS: '100' }),
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
          () => timeoutClient.verifyUserFile(FILE_ID, USER_ID, 'AVATAR'),
          503,
          'MEDIA_SERVICE_UNAVAILABLE',
        ),
    );
  } finally {
    clearTimeout(keepEventLoopAlive);
  }
});

test('bind sends exact fields and validates every echoed reference field', async () => {
  const expected = {
    callerService: 'profile-service',
    createdAt: '2026-08-27T03:02:00.000Z',
    fileId: FILE_ID,
    id: REFERENCE_ID,
    referenceId: 'profile-cv-primary',
    referenceType: 'CV',
  };
  const client = new HttpProfileMediaClient(createConfig());
  const reference = await withFetch(
    async (url, options) => {
      assert.equal(
        url,
        'https://media.internal.example/internal/references',
      );
      assert.deepEqual(JSON.parse(options.body), {
        expectedOwnerId: USER_ID,
        expectedOwnerType: 'USER',
        expectedType: 'CV',
        fileId: FILE_ID,
        referenceId: 'profile-cv-primary',
        referenceType: 'CV',
      });
      return envelopeResponse(expected, { status: 201 });
    },
    () =>
      client.bindUserFile(
        FILE_ID,
        USER_ID,
        'CV',
        'CV',
        'profile-cv-primary',
      ),
  );
  assert.deepEqual(reference, expected);

  await withFetch(
    async () =>
      envelopeResponse({ ...expected, callerService: 'other-service' }),
    () =>
      assertApiError(
        () =>
          client.bindUserFile(
            FILE_ID,
            USER_ID,
            'CV',
            'CV',
            'profile-cv-primary',
          ),
        503,
        'MEDIA_SERVICE_BAD_RESPONSE',
      ),
  );
});

test('release uses the reference UUID path and requires released=true', async () => {
  const client = new HttpProfileMediaClient(createConfig());
  await withFetch(
    async (url, options) => {
      assert.equal(
        url,
        'https://media.internal.example/internal/references/' +
          REFERENCE_ID,
      );
      assert.equal(options.method, 'DELETE');
      assert.equal(options.body, undefined);
      return envelopeResponse({ released: true });
    },
    () => client.releaseReference(REFERENCE_ID),
  );

  await withFetch(
    async () => envelopeResponse({ released: false }),
    () =>
      assertApiError(
        () => client.releaseReference(REFERENCE_ID),
        503,
        'MEDIA_SERVICE_BAD_RESPONSE',
      ),
  );
});

test('download sends the expectation and accepts only HTTPS future expiry', async () => {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const expected = {
    expiresAt,
    url: 'https://download.example/candidate.pdf?signature=opaque',
  };
  const client = new HttpProfileMediaClient(createConfig());
  const result = await withFetch(
    async (url, options) => {
      assert.equal(
        url,
        'https://media.internal.example/internal/download-url',
      );
      assert.deepEqual(JSON.parse(options.body), {
        expectedOwnerId: USER_ID,
        expectedOwnerType: 'USER',
        expectedType: 'CV',
        fileId: FILE_ID,
      });
      return envelopeResponse(expected);
    },
    () => client.createUserDownloadUrl(FILE_ID, USER_ID, 'CV'),
  );
  assert.deepEqual(result, expected);

  const invalidDownloads = [
    { ...expected, url: 'http://download.example/candidate.pdf' },
    { ...expected, expiresAt: new Date(Date.now() - 1000).toISOString() },
    { ...expected, expiresAt: '2099-01-01T00:00:00.000Z' },
    { ...expected, expiresAt: null },
  ];
  for (const invalid of invalidDownloads) {
    await withFetch(
      async () => envelopeResponse(invalid),
      () =>
        assertApiError(
          () => client.createUserDownloadUrl(FILE_ID, USER_ID, 'CV'),
          503,
          'MEDIA_SERVICE_BAD_RESPONSE',
        ),
    );
  }
});
