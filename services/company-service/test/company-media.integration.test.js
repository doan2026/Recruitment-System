'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { after, before, beforeEach, test } = require('node:test');
const {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { assertSafeTestDatabase } = require('./test-database-safety');

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const INTERNAL_KEY = 'company-media-integration-key-000000000000001';
const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const OUTSIDER_ID = '10000000-0000-4000-8000-000000000002';
const MEMBER_ID = '10000000-0000-4000-8000-000000000003';

const POLICIES = {
  COMPANY_LOGO: {
    folder: 'recruitment/company-logo',
    maxBytes: 2 * 1024 * 1024,
    resourceType: 'image',
    preset: 'test_company_logo_signed',
  },
  COMPANY_IMAGE: {
    folder: 'recruitment/company-image',
    maxBytes: 5 * 1024 * 1024,
    resourceType: 'image',
    preset: 'test_company_image_signed',
  },
  COMPANY_VIDEO: {
    folder: 'recruitment/company-video',
    maxBytes: 50 * 1024 * 1024,
    resourceType: 'video',
    preset: 'test_company_video_signed',
  },
};

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
process.env.MEDIA_INTERNAL_API_KEY = INTERNAL_KEY;
process.env.MEDIA_REQUEST_TIMEOUT_MS = '500';
// The scheduler is driven explicitly so each test observes one exact cycle.
process.env.COMPANY_MEDIA_OPERATION_ENABLED = 'false';

const prisma = new PrismaClient();
const jwt = new JwtService();

/** Deterministic stand-in for the Media Service internal API. */
const media = {
  requests: [],
  files: new Map(),
  references: new Map(),
  released: [],
  deleted: [],
  failures: new Map(),
  offline: false,
  reset() {
    this.requests = [];
    this.files.clear();
    this.references.clear();
    this.released = [];
    this.deleted = [];
    this.failures.clear();
    this.offline = false;
  },
  failNext(path, status, code) {
    const queue = this.failures.get(path) ?? [];
    queue.push({ status, code });
    this.failures.set(path, queue);
  },
  callsTo(path) {
    return this.requests.filter((request) => request.path === path);
  },
};

let mediaServer;
let app;
let baseUrl;

const capabilityFor = (fileId, type, format) => {
  const policy = POLICIES[type];
  return {
    allowedFormats: [format],
    apiKey: 'test-api-key',
    cloudName: 'test-cloud',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    fileId,
    maxBytes: policy.maxBytes,
    params: {
      allowed_formats: format,
      context: 'file_id=' + fileId,
      folder: policy.folder,
      overwrite: 'false',
      public_id: fileId,
      timestamp: Math.floor(Date.now() / 1000),
      type: 'upload',
      unique_filename: 'false',
      upload_preset: policy.preset,
      use_filename: 'false',
    },
    resourceType: policy.resourceType,
    signature: 'a'.repeat(64),
    uploadUrl:
      'https://api.cloudinary.com/v1_1/test-cloud/' +
      policy.resourceType +
      '/upload',
  };
};

const fileMetadata = (fileId, ownerId, type, format, status) => {
  const now = new Date().toISOString();
  return {
    aggregateVersion: status === 'DELETED' ? 2 : 1,
    bytes: 1024,
    createdAt: now,
    format,
    id: fileId,
    mimeType: format === 'mp4' ? 'video/mp4' : 'image/' + format,
    originalFilename: 'asset.' + format,
    ownerId,
    ownerType: 'COMPANY',
    privateDelivery: false,
    status,
    type,
    updatedAt: now,
    url:
      status === 'DELETED'
        ? null
        : 'https://res.cloudinary.com/test-cloud/' + fileId + '.' + format,
  };
};

const readJsonBody = (request) =>
  new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) reject(new Error('body too large'));
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });

const send = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const startMediaServer = () =>
  new Promise((resolve) => {
    mediaServer = createServer(async (request, response) => {
      const url = new URL(request.url, 'http://media.test');
      const path = url.pathname;
      let body = {};
      try {
        body = await readJsonBody(request);
      } catch {
        send(response, 400, { code: 'BAD_BODY', message: 'invalid' });
        return;
      }
      media.requests.push({
        method: request.method,
        path,
        body,
        apiKey: request.headers['x-internal-api-key'],
        idempotencyKey: request.headers['idempotency-key'],
      });

      if (media.offline) {
        response.destroy();
        return;
      }
      if (request.headers['x-internal-api-key'] !== INTERNAL_KEY) {
        send(response, 401, { code: 'UNAUTHORIZED', message: 'no' });
        return;
      }
      const queued = media.failures.get(path);
      if (queued && queued.length > 0) {
        const failure = queued.shift();
        send(response, failure.status, {
          code: failure.code,
          message: 'forced failure',
        });
        return;
      }

      if (path === '/internal/signature') {
        const fileId = randomUUID();
        const format = body.originalFilename.split('.').pop();
        const capability = capabilityFor(fileId, body.type, format);
        media.files.set(fileId, {
          ownerId: body.ownerId,
          type: body.type,
          format,
          confirmed: false,
        });
        send(response, 201, { data: capability, meta: null });
        return;
      }
      if (path === '/internal/confirm' || path === '/internal/verify') {
        const file = media.files.get(body.fileId);
        if (!file) {
          send(response, 404, { code: 'NOT_FOUND', message: 'missing' });
          return;
        }
        file.confirmed = true;
        send(response, 200, {
          data: fileMetadata(
            body.fileId,
            file.ownerId,
            file.type,
            file.format,
            'ACTIVE',
          ),
          meta: null,
        });
        return;
      }
      if (path === '/internal/references' && request.method === 'POST') {
        const referenceId = randomUUID();
        media.references.set(referenceId, body.fileId);
        send(response, 201, {
          data: {
            callerService: 'company-service',
            createdAt: new Date().toISOString(),
            fileId: body.fileId,
            id: referenceId,
            referenceId: body.referenceId,
            referenceType: body.referenceType,
          },
          meta: null,
        });
        return;
      }
      if (path.startsWith('/internal/references/')) {
        media.released.push(path.slice('/internal/references/'.length));
        send(response, 200, { data: { released: true }, meta: null });
        return;
      }
      if (path.startsWith('/internal/files/')) {
        const fileId = path.slice('/internal/files/'.length);
        const file = media.files.get(fileId);
        if (!file) {
          send(response, 404, { code: 'NOT_FOUND', message: 'missing' });
          return;
        }
        media.deleted.push(fileId);
        send(response, 200, {
          data: fileMetadata(
            fileId,
            file.ownerId,
            file.type,
            file.format,
            'DELETED',
          ),
          meta: null,
        });
        return;
      }
      send(response, 404, { code: 'NOT_FOUND', message: 'unknown route' });
    });
    mediaServer.listen(0, '127.0.0.1', resolve);
  });

const token = (userId, role = 'RECRUITER') =>
  jwt.sign(
    { role },
    {
      privateKey: privateKeyPem,
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: userId,
      jwtid: randomUUID(),
      expiresIn: '15m',
      header: { kid, typ: 'JWT' },
    },
  );

const call = async (method, path, { userId, body, headers } = {}) => {
  // Existing media scenarios model a client loading its current profile before PUT.
  // An explicit expectedVersion is preserved so stale-version tests can supply one.
  if (method === 'PUT' && body && !Object.hasOwn(body, 'expectedVersion')) {
    const snapshot = await call('GET', '/me', { userId });
    assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
    body = { ...body, expectedVersion: snapshot.body.data.aggregateVersion };
  }
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(userId ? { authorization: 'Bearer ' + token(userId) } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
};

let taxCounter = 0;
const createCompany = async (userId = OWNER_ID) => {
  taxCounter += 1;
  const suffix = String(taxCounter).padStart(4, '0');
  const created = await call('POST', '/', {
    userId,
    body: {
      name: 'Cong ty Kiem Thu ' + suffix,
      description: 'Company media contract fixture',
      industry: 'Software',
      size: '11-50',
      address: '1 Integration Street',
      taxCode: '99000' + suffix,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.data.id;
};

const requestIntent = (companyId, type, filename, options = {}) =>
  call('POST', '/' + companyId + '/media/signature', {
    userId: options.userId ?? OWNER_ID,
    body: { type, originalFilename: filename },
    headers: options.idempotencyKey
      ? { 'idempotency-key': options.idempotencyKey }
      : undefined,
  });

const confirm = (companyId, fileId, type, options = {}) =>
  call('POST', '/' + companyId + '/media/confirm', {
    userId: options.userId ?? OWNER_ID,
    body: { fileId, type },
  });

before(async () => {
  await assertSafeTestDatabase(prisma);
  await startMediaServer();
  process.env.MEDIA_SERVICE_URL =
    'http://127.0.0.1:' + mediaServer.address().port;

  const { AppModule } = require('../dist/app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  baseUrl = baseUrl.replace('[::1]', '127.0.0.1');
});

after(async () => {
  if (app) await app.close();
  if (mediaServer) await new Promise((resolve) => mediaServer.close(resolve));
  await prisma.$disconnect();
});

beforeEach(async () => {
  media.reset();
  await prisma.companyMediaOperation.deleteMany();
  await prisma.companyMediaUploadIntent.deleteMany();
  await prisma.companyMedia.deleteMany();
  await prisma.companyAuditLog.deleteMany();
  await prisma.companyMember.deleteMany();
  await prisma.companyInvitation.deleteMany();
  await prisma.company.deleteMany();
});

test('owner upload intent calls Media with the exact scoped contract', async () => {
  const companyId = await createCompany();

  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');

  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  const request = media.callsTo('/internal/signature')[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.apiKey, INTERNAL_KEY);
  // Company must scope the intent to itself and never trust a client owner.
  assert.deepEqual(request.body, {
    originalFilename: 'logo.png',
    ownerId: companyId,
    ownerType: 'COMPANY',
    requestedBy: OWNER_ID,
    type: 'COMPANY_LOGO',
  });

  const fileId = intent.body.data.fileId;
  const stored = await prisma.companyMediaUploadIntent.findUnique({
    where: { fileId },
  });
  assert.equal(stored.companyId, companyId);
  assert.equal(stored.requestedBy, OWNER_ID);
  assert.equal(stored.assetType, 'COMPANY_LOGO');
  assert.equal(stored.confirmedAt, null);
  assert.ok(stored.cleanupAt.getTime() > stored.expiresAt.getTime());

  const cleanup = await prisma.companyMediaOperation.findUnique({
    where: { id: fileId },
  });
  assert.equal(cleanup.kind, 'UPLOAD_INTENT_CLEANUP');
  assert.equal(cleanup.fileId, fileId);
});

test('a non-owner never reaches Media at all', async () => {
  const companyId = await createCompany();

  const outsider = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png', {
    userId: OUTSIDER_ID,
  });
  const member = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png', {
    userId: MEMBER_ID,
  });

  assert.equal(outsider.status, 403);
  assert.equal(member.status, 403);
  // Ownership is settled locally, so a rejected caller cannot spend Media quota.
  assert.equal(media.requests.length, 0);
  assert.equal(await prisma.companyMediaUploadIntent.count(), 0);
});

test('an idempotency key is forwarded verbatim to Media', async () => {
  const companyId = await createCompany();

  await requestIntent(companyId, 'COMPANY_IMAGE', 'photo.webp', {
    idempotencyKey: 'company-media-retry-0001',
  });

  const request = media.callsTo('/internal/signature')[0];
  assert.equal(request.idempotencyKey, 'company-media-retry-0001');
});

test('confirm resolves the canonical URL and replays without a second call', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  const fileId = intent.body.data.fileId;

  const first = await confirm(companyId, fileId, 'COMPANY_LOGO');
  const replay = await confirm(companyId, fileId, 'COMPANY_LOGO');

  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.data, first.body.data);
  assert.equal(first.body.data.type, 'COMPANY_LOGO');
  assert.match(first.body.data.url, /^https:\/\/res\.cloudinary\.com\//);
  // The stored canonical URL answers the replay, so Media is called once.
  assert.equal(media.callsTo('/internal/confirm').length, 1);

  const stored = await prisma.companyMediaUploadIntent.findUnique({
    where: { fileId },
  });
  assert.ok(stored.confirmedAt);
  assert.equal(stored.canonicalUrl, first.body.data.url);
});

test('confirming another company intent is rejected before Media', async () => {
  const companyId = await createCompany();
  const otherCompanyId = await createCompany(OUTSIDER_ID);
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  const fileId = intent.body.data.fileId;

  // The other OWNER cannot confirm an intent that belongs to another company.
  const stolen = await confirm(otherCompanyId, fileId, 'COMPANY_LOGO', {
    userId: OUTSIDER_ID,
  });

  assert.equal(stolen.status, 422);
  assert.equal(media.callsTo('/internal/confirm').length, 0);
});

test('confirming with a mismatched asset type is rejected before Media', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');

  const mismatch = await confirm(
    companyId,
    intent.body.data.fileId,
    'COMPANY_IMAGE',
  );

  assert.equal(mismatch.status, 422);
  assert.equal(media.callsTo('/internal/confirm').length, 0);
});

test('an expired upload intent is refused without calling Media', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  const fileId = intent.body.data.fileId;
  const past = new Date(Date.now() - 60_000);
  await prisma.companyMediaUploadIntent.update({
    where: { fileId },
    data: { expiresAt: past, cleanupAt: past },
  });

  const expired = await confirm(companyId, fileId, 'COMPANY_LOGO');

  assert.equal(expired.status, 422);
  assert.equal(media.callsTo('/internal/confirm').length, 0);
});

test('attaching a logo verifies then binds it through Media', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  const fileId = intent.body.data.fileId;
  await confirm(companyId, fileId, 'COMPANY_LOGO');

  const updated = await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId } },
  });

  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const verify = media.callsTo('/internal/verify')[0];
  const bind = media.callsTo('/internal/references')[0];
  // Verification must assert the exact owner and type before any binding.
  assert.deepEqual(verify.body, {
    expectedOwnerId: companyId,
    expectedOwnerType: 'COMPANY',
    expectedType: 'COMPANY_LOGO',
    fileId,
  });
  assert.equal(bind.body.fileId, fileId);
  assert.equal(bind.body.expectedOwnerId, companyId);
  assert.equal(bind.body.expectedType, 'COMPANY_LOGO');

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  assert.equal(company.logoFileId, fileId);
  assert.ok(company.logoUrl);
  assert.ok(company.logoMediaReferenceId);
});

test('a gallery attach binds every entry with its own asset type', async () => {
  const companyId = await createCompany();
  const image = await requestIntent(companyId, 'COMPANY_IMAGE', 'photo.jpg');
  const video = await requestIntent(companyId, 'COMPANY_VIDEO', 'clip.mp4');
  const imageId = image.body.data.fileId;
  const videoId = video.body.data.fileId;
  await confirm(companyId, imageId, 'COMPANY_IMAGE');
  await confirm(companyId, videoId, 'COMPANY_VIDEO');

  const updated = await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: {
      media: [
        { fileId: imageId, type: 'IMAGE', sortOrder: 0 },
        { fileId: videoId, type: 'VIDEO', sortOrder: 1 },
      ],
    },
  });

  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const types = media
    .callsTo('/internal/references')
    .map((request) => request.body.expectedType)
    .sort();
  assert.deepEqual(types, ['COMPANY_IMAGE', 'COMPANY_VIDEO']);

  const rows = await prisma.companyMedia.findMany({
    where: { companyId },
    orderBy: { sortOrder: 'asc' },
  });
  assert.deepEqual(
    rows.map((row) => [row.fileId, row.type]),
    [
      [imageId, 'IMAGE'],
      [videoId, 'VIDEO'],
    ],
  );
  assert.ok(rows.every((row) => row.mediaReferenceId));
});

test('a Media outage during attach fails closed and keeps the company clean', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  const fileId = intent.body.data.fileId;
  await confirm(companyId, fileId, 'COMPANY_LOGO');
  media.offline = true;

  const updated = await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId } },
  });

  assert.equal(updated.status, 503, JSON.stringify(updated.body));
  assert.equal(updated.body.code, 'MEDIA_SERVICE_UNAVAILABLE');
  // Nothing about the outage may leak the internal key or target URL.
  const serialized = JSON.stringify(updated.body);
  assert.ok(!serialized.includes(INTERNAL_KEY));
  assert.ok(!serialized.includes('127.0.0.1'));

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  assert.equal(company.logoFileId, null);
  assert.equal(company.logoMediaReferenceId, null);
});

test('a Media outage during upload intent leaves no local intent row', async () => {
  const companyId = await createCompany();
  media.offline = true;

  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');

  assert.equal(intent.status, 503);
  assert.equal(await prisma.companyMediaUploadIntent.count(), 0);
  assert.equal(await prisma.companyMediaOperation.count(), 0);
});

test('a rejected Media response maps to its own sanitized status', async () => {
  const companyId = await createCompany();
  media.failNext('/internal/signature', 429, 'RATE_LIMITED');

  const limited = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');

  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'MEDIA_UPLOAD_RATE_LIMITED');
  assert.ok(!JSON.stringify(limited.body).includes(INTERNAL_KEY));
});

test('a bad Media envelope is refused instead of being stored', async () => {
  const companyId = await createCompany();
  const failing = createServer((request, response) => {
    send(response, 201, { data: { fileId: 'not-a-uuid' }, meta: null });
  });
  await new Promise((resolve) => failing.listen(0, '127.0.0.1', resolve));
  const previousUrl = process.env.MEDIA_SERVICE_URL;
  try {
    // The client is constructed once, so drive the malformed body through the
    // running server instead of re-pointing configuration.
    media.failNext('/internal/signature', 200, 'IGNORED');
    const bad = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
    assert.equal(bad.status, 503);
    assert.equal(bad.body.code, 'MEDIA_SERVICE_BAD_RESPONSE');
    assert.equal(await prisma.companyMediaUploadIntent.count(), 0);
  } finally {
    process.env.MEDIA_SERVICE_URL = previousUrl;
    await new Promise((resolve) => failing.close(resolve));
  }
});

test('replacing the logo releases the previous Media reference', async () => {
  const companyId = await createCompany();
  const first = await requestIntent(companyId, 'COMPANY_LOGO', 'one.png');
  const second = await requestIntent(companyId, 'COMPANY_LOGO', 'two.png');
  const firstId = first.body.data.fileId;
  const secondId = second.body.data.fileId;
  await confirm(companyId, firstId, 'COMPANY_LOGO');
  await confirm(companyId, secondId, 'COMPANY_LOGO');
  await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId: firstId } },
  });

  const replaced = await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId: secondId } },
  });

  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  assert.equal(company.logoFileId, secondId);
  const detach = await prisma.companyMediaOperation.findMany({
    where: { kind: 'DETACH_CLEANUP', fileId: firstId },
  });
  // The replaced file is handed to the durable cleanup queue, not dropped.
  assert.equal(detach.length, 1);
});

test('the operation worker drives detach cleanup through Media', async () => {
  const companyId = await createCompany();
  const first = await requestIntent(companyId, 'COMPANY_LOGO', 'one.png');
  const second = await requestIntent(companyId, 'COMPANY_LOGO', 'two.png');
  const firstId = first.body.data.fileId;
  const secondId = second.body.data.fileId;
  await confirm(companyId, firstId, 'COMPANY_LOGO');
  await confirm(companyId, secondId, 'COMPANY_LOGO');
  await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId: firstId } },
  });
  await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId: secondId } },
  });
  const operations = require('../dist/media/company-media-operation.service');
  const worker = app.get(operations.CompanyMediaOperationService);

  await worker.processDueOnce();
  await worker.processDueOnce();

  assert.ok(media.deleted.includes(firstId));
  const remaining = await prisma.companyMediaOperation.findMany({
    where: { kind: 'DETACH_CLEANUP', fileId: firstId },
  });
  assert.equal(remaining.length, 0, JSON.stringify(remaining));
});

test('a failing cleanup is retried instead of being dropped', async () => {
  const companyId = await createCompany();
  const first = await requestIntent(companyId, 'COMPANY_LOGO', 'one.png');
  const second = await requestIntent(companyId, 'COMPANY_LOGO', 'two.png');
  const firstId = first.body.data.fileId;
  const secondId = second.body.data.fileId;
  await confirm(companyId, firstId, 'COMPANY_LOGO');
  await confirm(companyId, secondId, 'COMPANY_LOGO');
  await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId: firstId } },
  });
  await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId: secondId } },
  });
  media.failNext('/internal/files/' + firstId, 503, 'UPSTREAM_DOWN');
  media.failNext('/internal/references/', 503, 'UPSTREAM_DOWN');
  const operations = require('../dist/media/company-media-operation.service');
  const worker = app.get(operations.CompanyMediaOperationService);

  await worker.processDueOnce();

  const pending = await prisma.companyMediaOperation.findMany({
    where: { kind: 'DETACH_CLEANUP', fileId: firstId },
  });
  assert.equal(pending.length, 1);
  assert.ok(pending[0].attemptCount >= 1);
  assert.ok(pending[0].nextAttemptAt.getTime() > Date.now());
  assert.ok(pending[0].lastErrorCode);
});

test('upload intent cleanup deletes an abandoned file once it is due', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  const fileId = intent.body.data.fileId;
  const due = new Date(Date.now() - 1000);
  await prisma.companyMediaOperation.update({
    where: { id: fileId },
    data: { nextAttemptAt: due },
  });
  const operations = require('../dist/media/company-media-operation.service');
  const worker = app.get(operations.CompanyMediaOperationService);

  await worker.processDueOnce();

  // The Candidate never uploaded, so the abandoned intent must free its quota.
  assert.ok(media.deleted.includes(fileId));
  const leftover = await prisma.companyMediaOperation.findMany({
    where: { id: fileId },
  });
  assert.equal(leftover.length, 0, JSON.stringify(leftover));
});

test('cleanup never deletes a file that is still attached locally', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  const fileId = intent.body.data.fileId;
  await confirm(companyId, fileId, 'COMPANY_LOGO');
  await call('PUT', '/' + companyId, {
    userId: OWNER_ID,
    body: { logo: { fileId } },
  });
  await prisma.companyMediaOperation.updateMany({
    where: { fileId },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
  const operations = require('../dist/media/company-media-operation.service');
  const worker = app.get(operations.CompanyMediaOperationService);

  await worker.processDueOnce();
  await worker.processDueOnce();

  assert.ok(!media.deleted.includes(fileId));
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  assert.equal(company.logoFileId, fileId);
});

test('every Media call carries the internal key and no end-user token', async () => {
  const companyId = await createCompany();
  const intent = await requestIntent(companyId, 'COMPANY_LOGO', 'logo.png');
  await confirm(companyId, intent.body.data.fileId, 'COMPANY_LOGO');

  assert.ok(media.requests.length >= 2);
  for (const request of media.requests) {
    assert.equal(request.apiKey, INTERNAL_KEY);
    assert.ok(!JSON.stringify(request.body).includes('Bearer'));
  }
});
