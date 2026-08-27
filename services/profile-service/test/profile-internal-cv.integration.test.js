'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { after, before, test } = require('node:test');
const {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { CvType, PrismaClient } = require('@prisma/client');
const {
  assertSafeTestDatabase,
} = require('./test-database-safety');

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const APPLICATION_KEY =
  'profile-application-contract-key-00000000000001';
const MEDIA_KEY = 'profile-media-contract-key-000000000000000001';
const CANDIDATE_A = '10000000-0000-4000-8000-000000000061';
const CANDIDATE_B = '10000000-0000-4000-8000-000000000062';
const ACTIVE_CV_ID = '20000000-0000-4000-8000-000000000061';
const ONLINE_CV_ID = '20000000-0000-4000-8000-000000000062';
const DELETED_CV_ID = '20000000-0000-4000-8000-000000000063';
const LEGACY_CV_ID = '20000000-0000-4000-8000-000000000064';
const OTHER_CV_ID = '20000000-0000-4000-8000-000000000065';
const ACTIVE_FILE_ID = '30000000-0000-4000-8000-000000000061';
const ONLINE_FILE_ID = '30000000-0000-4000-8000-000000000062';
const DELETED_FILE_ID = '30000000-0000-4000-8000-000000000063';
const LEGACY_FILE_ID = '30000000-0000-4000-8000-000000000064';
const OTHER_FILE_ID = '30000000-0000-4000-8000-000000000065';
const INTERNAL_CV_KEYS = [
  'aggregateVersion',
  'candidateId',
  'createdAt',
  'cvId',
  'fileId',
  'firstUsedAt',
  'isDefault',
  'isDeleted',
  'title',
  'type',
  'updatedAt',
].sort();

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const publicJwk = createPublicKey(publicKeyPem).export({ format: 'jwk' });
const kid = createHash('sha256')
  .update(JSON.stringify({ e: publicJwk.e, kty: 'RSA', n: publicJwk.n }))
  .digest('base64url');

process.env.JWT_PUBLIC_KEY = publicKeyPem;
process.env.JWT_PUBLIC_KEY_PATH = '';
process.env.JWT_JWKS_URI = '';
process.env.JWT_ISSUER = ISSUER;
process.env.JWT_AUDIENCE = AUDIENCE;
process.env.INTERNAL_API_KEY_APPLICATION = APPLICATION_KEY;
process.env.MEDIA_INTERNAL_API_KEY = MEDIA_KEY;
process.env.MEDIA_REQUEST_TIMEOUT_MS = '500';
process.env.SWAGGER_ENABLED = 'true';

const prisma = new PrismaClient();
const jwt = new JwtService();
const mediaRequests = [];
let mediaDownloadExpiresAtOverride = null;
let mediaServer;
let app;
let baseUrl;
let canResetSchema = false;

const accessToken = (subject, role = 'CANDIDATE') =>
  jwt.sign(
    { role },
    {
      privateKey: privateKeyPem,
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject,
      jwtid: randomUUID(),
      expiresIn: '15m',
      header: { kid, typ: 'JWT' },
    },
  );

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
    : undefined;
};

const json = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const handleMedia = async (request, response) => {
  const body = await readBody(request);
  mediaRequests.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body,
  });
  if (
    request.headers['x-internal-api-key'] !== MEDIA_KEY ||
    request.headers['x-internal-service'] !== 'profile-service'
  ) {
    return json(response, 401, { code: 'UNAUTHORIZED' });
  }
  if (
    request.method !== 'POST' ||
    request.url !== '/internal/download-url'
  ) {
    return json(response, 404, { code: 'NOT_FOUND' });
  }
  return json(response, 200, {
    data: {
      url: `https://download.example/${body.fileId}?token=short-lived`,
      expiresAt:
        mediaDownloadExpiresAtOverride ??
        new Date(Date.now() + 60_000).toISOString(),
    },
    meta: null,
  });
};

const internalHeaders = (overrides = {}) => ({
  'x-internal-api-key': APPLICATION_KEY,
  'x-internal-service': 'application-service',
  ...overrides,
});

const api = async (method, path, options = {}) => {
  const headers = {
    accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
};

const success = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.meta, null);
  return response.body.data;
};

const assertInternalCv = (cv) => {
  assert.deepEqual(Object.keys(cv).sort(), INTERNAL_CV_KEYS);
  assert.equal('fileUrl' in cv, false);
  assert.equal('mediaReferenceId' in cv, false);
  assert.equal('contentJson' in cv, false);
};

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."profiles" CASCADE',
  );

  mediaServer = createServer((request, response) => {
    handleMedia(request, response).catch((error) =>
      json(response, 500, {
        code: 'FAKE_MEDIA_ERROR',
        message: error.message,
      }),
    );
  });
  await new Promise((resolve) => mediaServer.listen(0, '127.0.0.1', resolve));
  process.env.MEDIA_SERVICE_URL =
    'http://127.0.0.1:' + mediaServer.address().port;

  const createdAt = new Date('2026-08-27T01:00:00.000Z');
  const updatedAt = new Date('2026-08-27T01:01:00.000Z');
  await prisma.profile.createMany({
    data: [
      { userId: CANDIDATE_A, createdAt, updatedAt },
      { userId: CANDIDATE_B, createdAt, updatedAt },
    ],
  });
  await prisma.cv.create({
    data: {
      id: ACTIVE_CV_ID,
      userId: CANDIDATE_A,
      title: 'Backend CV',
      type: CvType.UPLOAD,
      fileId: ACTIVE_FILE_ID,
      fileUrl: null,
      mediaReferenceId: '40000000-0000-4000-8000-000000000061',
      isDefault: true,
      createdAt,
      updatedAt,
    },
  });
  await prisma.cv.create({
    data: {
      id: ONLINE_CV_ID,
      userId: CANDIDATE_A,
      title: 'Online CV',
      type: CvType.ONLINE,
      fileId: ONLINE_FILE_ID,
      fileUrl: null,
      mediaReferenceId: '40000000-0000-4000-8000-000000000062',
      templateId: 'classic',
      contentJson: { basics: { name: 'Candidate A' } },
      contentSchemaVersion: 1,
      createdAt: new Date('2026-08-27T02:00:00.000Z'),
      updatedAt: new Date('2026-08-27T02:01:00.000Z'),
    },
  });
  await prisma.cv.create({
    data: {
      id: DELETED_CV_ID,
      userId: CANDIDATE_A,
      title: 'Submitted CV',
      type: CvType.UPLOAD,
      fileId: DELETED_FILE_ID,
      fileUrl: null,
      mediaReferenceId: '40000000-0000-4000-8000-000000000063',
      isDeleted: true,
      firstUsedAt: new Date('2026-08-27T03:00:00.000Z'),
      deletedAt: new Date('2026-08-27T04:00:00.000Z'),
      createdAt,
      updatedAt: new Date('2026-08-27T04:00:00.000Z'),
    },
  });
  await prisma.cv.create({
    data: {
      id: LEGACY_CV_ID,
      userId: CANDIDATE_A,
      title: 'Legacy URL CV',
      type: CvType.UPLOAD,
      fileId: LEGACY_FILE_ID,
      fileUrl: 'https://legacy.example/candidate.pdf',
      mediaReferenceId: null,
      createdAt: new Date('2026-08-27T05:00:00.000Z'),
      updatedAt: new Date('2026-08-27T05:01:00.000Z'),
    },
  });
  await prisma.cv.create({
    data: {
      id: OTHER_CV_ID,
      userId: CANDIDATE_B,
      title: 'Candidate B CV',
      type: CvType.UPLOAD,
      fileId: OTHER_FILE_ID,
      fileUrl: null,
      mediaReferenceId: '40000000-0000-4000-8000-000000000065',
      isDefault: true,
      createdAt,
      updatedAt,
    },
  });

  const { AppModule } = require('../dist/app.module');
  const { configureApplication } = require('../dist/main');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + app.getHttpServer().address().port;
});

after(async () => {
  try {
    if (canResetSchema) {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "profile"."profiles" CASCADE',
      );
    }
    if (app) await app.close();
    if (mediaServer) {
      await new Promise((resolve, reject) =>
        mediaServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('Profile internal CV v1 contract', async (t) => {
  const candidateToken = accessToken(CANDIDATE_A);

  await t.test('fails closed unless the exact internal identity is present', async () => {
    const cases = [
      {},
      { 'x-internal-service': 'application-service' },
      { 'x-internal-api-key': APPLICATION_KEY },
      internalHeaders({ 'x-internal-api-key': APPLICATION_KEY.slice(1) }),
      internalHeaders({ 'x-internal-service': 'profile-service' }),
      internalHeaders({ 'x-internal-service': 'Application-Service' }),
    ];
    for (const headers of cases) {
      const response = await api(
        'GET',
        `/internal/v1/candidates/${CANDIDATE_A}/cvs`,
        { headers },
      );
      assert.equal(response.status, 401, JSON.stringify(response.body));
      assert.equal(response.body.code, 'INTERNAL_AUTH_INVALID');
    }

    const duplicateResponse = await fetch(
      baseUrl + `/internal/v1/candidates/${CANDIDATE_A}/cvs`,
      {
        headers: [
          ['accept', 'application/json'],
          ['x-internal-api-key', APPLICATION_KEY],
          ['x-internal-api-key', APPLICATION_KEY],
          ['x-internal-service', 'application-service'],
          ['x-internal-service', 'application-service'],
        ],
      },
    );
    assert.equal(duplicateResponse.status, 401);
    assert.equal(
      (await duplicateResponse.json()).code,
      'INTERNAL_AUTH_INVALID',
    );
  });

  await t.test('verify requires matching strict Candidate JWT in addition to internal auth', async () => {
    const body = { candidateId: CANDIDATE_A, cvId: ACTIVE_CV_ID };
    const noJwt = await api('POST', '/internal/v1/cvs/verify', {
      headers: internalHeaders(),
      body,
    });
    assert.equal(noJwt.status, 401);

    const malformedJwt = await api('POST', '/internal/v1/cvs/verify', {
      headers: internalHeaders({ authorization: 'Bearer malformed.token' }),
      body,
    });
    assert.equal(malformedJwt.status, 401);

    const recruiter = await api('POST', '/internal/v1/cvs/verify', {
      headers: internalHeaders({
        authorization: `Bearer ${accessToken(CANDIDATE_A, 'RECRUITER')}`,
      }),
      body,
    });
    assert.equal(recruiter.status, 403);

    const wrongSubject = await api('POST', '/internal/v1/cvs/verify', {
      headers: internalHeaders({
        authorization: `Bearer ${accessToken(CANDIDATE_B)}`,
      }),
      body,
    });
    assert.equal(wrongSubject.status, 403);
    assert.equal(wrongSubject.body.code, 'PROFILE_OWNER_REQUIRED');

    const noInternalIdentity = await api('POST', '/internal/v1/cvs/verify', {
      headers: { authorization: `Bearer ${candidateToken}` },
      body,
    });
    assert.equal(noInternalIdentity.status, 401);
    assert.equal(noInternalIdentity.body.code, 'INTERNAL_AUTH_INVALID');
  });

  await t.test('verify canonicalizes UUIDs and hides all unavailable variants', async () => {
    const verified = success(
      await api('POST', '/internal/v1/cvs/verify', {
        headers: internalHeaders({
          authorization: `Bearer ${candidateToken}`,
        }),
        body: {
          candidateId: CANDIDATE_A.toUpperCase(),
          cvId: ACTIVE_CV_ID.toUpperCase(),
        },
      }),
    );
    assert.deepEqual(Object.keys(verified).sort(), [
      'available',
      'candidateId',
      'cv',
      'cvId',
    ]);
    assert.equal(verified.candidateId, CANDIDATE_A);
    assert.equal(verified.cvId, ACTIVE_CV_ID);
    assert.equal(verified.available, true);
    assertInternalCv(verified.cv);

    for (const cvId of [
      randomUUID(),
      OTHER_CV_ID,
      DELETED_CV_ID,
      LEGACY_CV_ID,
    ]) {
      const unavailable = success(
        await api('POST', '/internal/v1/cvs/verify', {
          headers: internalHeaders({
            authorization: `Bearer ${candidateToken}`,
          }),
          body: { candidateId: CANDIDATE_A, cvId },
        }),
      );
      assert.deepEqual(unavailable, {
        candidateId: CANDIDATE_A,
        cvId: cvId.toLowerCase(),
        available: false,
        cv: null,
      });
    }
  });

  await t.test('list exposes only active Media-backed CVs and no private implementation fields', async () => {
    const list = success(
      await api(
        'GET',
        `/internal/v1/candidates/${CANDIDATE_A.toUpperCase()}/cvs`,
        { headers: internalHeaders() },
      ),
    );
    assert.deepEqual(
      list.map((cv) => cv.cvId),
      [ACTIVE_CV_ID, ONLINE_CV_ID],
    );
    assert.equal(list[0].isDefault, true);
    assert.equal(list[1].type, 'ONLINE');
    for (const cv of list) {
      assertInternalCv(cv);
      assert.equal(cv.candidateId, CANDIDATE_A);
      assert.equal(cv.isDeleted, false);
    }
  });

  await t.test('detail is owner-exact, excludes legacy URLs, and preserves soft-deleted submissions', async () => {
    const deleted = success(
      await api(
        'GET',
        `/internal/v1/candidates/${CANDIDATE_A}/cvs/${DELETED_CV_ID}`,
        { headers: internalHeaders() },
      ),
    );
    assertInternalCv(deleted);
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.firstUsedAt, '2026-08-27T03:00:00.000Z');

    for (const [candidateId, cvId] of [
      [CANDIDATE_B, ACTIVE_CV_ID],
      [CANDIDATE_A, OTHER_CV_ID],
      [CANDIDATE_A, LEGACY_CV_ID],
      [CANDIDATE_A, randomUUID()],
    ]) {
      const missing = await api(
        'GET',
        `/internal/v1/candidates/${candidateId}/cvs/${cvId}`,
        { headers: internalHeaders() },
      );
      assert.equal(missing.status, 404);
      assert.equal(missing.body.code, 'CV_NOT_FOUND');
    }
  });

  await t.test('download is owner-exact, private, no-store, and supports a deleted used CV', async () => {
    const beforeCalls = mediaRequests.length;
    const response = await api(
      'POST',
      `/internal/v1/candidates/${CANDIDATE_A.toUpperCase()}/cvs/${DELETED_CV_ID.toUpperCase()}/download-url`,
      { headers: internalHeaders() },
    );
    const download = success(response);
    assert.deepEqual(Object.keys(download).sort(), [
      'candidateId',
      'cvId',
      'expiresAt',
      'url',
    ]);
    assert.equal(download.candidateId, CANDIDATE_A);
    assert.equal(download.cvId, DELETED_CV_ID);
    assert.match(download.url, /^https:\/\/download\.example\//);
    assert.ok(Date.parse(download.expiresAt) > Date.now());
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('pragma'), 'no-cache');

    assert.equal(mediaRequests.length, beforeCalls + 1);
    assert.deepEqual(mediaRequests.at(-1).body, {
      expectedOwnerId: CANDIDATE_A,
      expectedOwnerType: 'USER',
      expectedType: 'CV',
      fileId: DELETED_FILE_ID,
    });

    const idor = await api(
      'POST',
      `/internal/v1/candidates/${CANDIDATE_B}/cvs/${DELETED_CV_ID}/download-url`,
      { headers: internalHeaders() },
    );
    assert.equal(idor.status, 404);
    assert.equal(idor.body.code, 'CV_NOT_FOUND');
    assert.equal(mediaRequests.length, beforeCalls + 1);

    mediaDownloadExpiresAtOverride = '2099-01-01T00:00:00.000Z';
    try {
      const excessiveTtl = await api(
        'POST',
        `/internal/v1/candidates/${CANDIDATE_A}/cvs/${ACTIVE_CV_ID}/download-url`,
        { headers: internalHeaders() },
      );
      assert.equal(excessiveTtl.status, 503);
      assert.equal(
        excessiveTtl.body.code,
        'MEDIA_SERVICE_BAD_RESPONSE',
      );
    } finally {
      mediaDownloadExpiresAtOverride = null;
    }
  });

  await t.test('strict validation rejects malformed UUIDs and unknown fields', async () => {
    const malformedBody = await api('POST', '/internal/v1/cvs/verify', {
      headers: internalHeaders({
        authorization: `Bearer ${candidateToken}`,
      }),
      body: { candidateId: 'not-a-uuid', cvId: ACTIVE_CV_ID },
    });
    assert.equal(malformedBody.status, 400);
    assert.equal(malformedBody.body.code, 'VALIDATION_ERROR');

    const extraField = await api('POST', '/internal/v1/cvs/verify', {
      headers: internalHeaders({
        authorization: `Bearer ${candidateToken}`,
      }),
      body: {
        candidateId: CANDIDATE_A,
        cvId: ACTIVE_CV_ID,
        fileUrl: 'https://attacker.example/cv.pdf',
      },
    });
    assert.equal(extraField.status, 400);
    assert.equal(extraField.body.code, 'VALIDATION_ERROR');

    const malformedPath = await api(
      'GET',
      `/internal/v1/candidates/not-a-uuid/cvs/${ACTIVE_CV_ID}`,
      { headers: internalHeaders() },
    );
    assert.equal(malformedPath.status, 400);
  });

  await t.test('internal routes are absent from the public Swagger document', async () => {
    const response = await api('GET', '/docs-json');
    assert.equal(response.status, 200);
    const paths = Object.keys(response.body.paths ?? {});
    assert.equal(paths.some((path) => path.startsWith('/internal/')), false);
  });

  await t.test('health validates the configured internal key', async () => {
    const health = success(await api('GET', '/health'));
    assert.deepEqual(health, { service: 'profile-service', status: 'UP' });
  });
});
