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
  RETAINED_CV_SNAPSHOT_LIMIT,
} = require('../dist/profile/cv-limits');
const {
  MAX_CV_BUILDER_CONTENT_BYTES,
} = require('../dist/profile/dto/cv-builder-content.decorator');
const {
  assertSafeTestDatabase,
} = require('./test-database-safety');

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const MEDIA_KEY = 'profile-builder-media-key-0000000000000000001';
const APPLICATION_INBOUND_KEY =
  'application-to-profile-builder-key-0000000000001';
const APPLICATION_OUTBOUND_KEY =
  'profile-to-application-builder-key-0000000000001';

const CANDIDATE_A = '31000000-0000-4000-8000-000000000001';
const CANDIDATE_B = '31000000-0000-4000-8000-000000000002';
const CANDIDATE_C = '31000000-0000-4000-8000-000000000003';
const CANDIDATE_D = '31000000-0000-4000-8000-000000000004';
const CANDIDATE_E = '31000000-0000-4000-8000-000000000005';
const CANDIDATE_F = '31000000-0000-4000-8000-000000000006';
const CANDIDATE_G = '31000000-0000-4000-8000-000000000007';
const CANDIDATE_H = '31000000-0000-4000-8000-000000000008';

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
process.env.MEDIA_INTERNAL_API_KEY = MEDIA_KEY;
process.env.MEDIA_REQUEST_TIMEOUT_MS = '500';
process.env.INTERNAL_API_KEY_APPLICATION = APPLICATION_INBOUND_KEY;
process.env.APPLICATION_INTERNAL_API_KEY = APPLICATION_OUTBOUND_KEY;
process.env.APPLICATION_SERVICE_URL = 'http://127.0.0.1:9';
process.env.APPLICATION_REQUEST_TIMEOUT_MS = '500';
process.env.SWAGGER_ENABLED = 'true';

const prisma = new PrismaClient();
const jwt = new JwtService();
const files = new Map();
const references = new Map();
const mediaRequests = [];
let mediaServer;
let mediaBindBarrier;
let app;
let baseUrl;
let canResetSchema = false;

const accessToken = (subject) =>
  jwt.sign(
    { role: 'CANDIDATE' },
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

const success = (response, status, data) =>
  json(response, status, { data, meta: null });

const metadata = (file) => ({
  id: file.id,
  ownerType: 'USER',
  ownerId: file.ownerId,
  type: 'CV',
  status: file.status ?? 'ACTIVE',
  originalFilename: 'builder-export.pdf',
  mimeType: 'application/pdf',
  format: 'pdf',
  bytes: 4096,
  url: null,
  privateDelivery: true,
  aggregateVersion: 1,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
});

const resolveFile = (body) => {
  const file = files.get(body?.fileId);
  if (
    !file ||
    file.ownerId !== body.expectedOwnerId ||
    body.expectedOwnerType !== 'USER' ||
    body.expectedType !== 'CV' ||
    (file.status ?? 'ACTIVE') !== 'ACTIVE'
  ) {
    return null;
  }
  return file;
};

const handleMediaRequest = async (request, response) => {
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
  if (request.method === 'POST' && request.url === '/internal/verify') {
    const file = resolveFile(body);
    return file
      ? success(response, 200, metadata(file))
      : json(response, 404, { code: 'MEDIA_FILE_NOT_FOUND' });
  }
  if (
    request.method === 'POST' &&
    request.url === '/internal/references'
  ) {
    const file = resolveFile(body);
    if (!file) return json(response, 404, { code: 'MEDIA_FILE_NOT_FOUND' });
    if (mediaBindBarrier?.fileIds.has(body.fileId)) {
      mediaBindBarrier.arrivals += 1;
      if (mediaBindBarrier.arrivals === mediaBindBarrier.expected) {
        mediaBindBarrier.release();
      }
      await mediaBindBarrier.released;
    }
    const key = [body.fileId, body.referenceType, body.referenceId].join('|');
    let reference = references.get(key);
    if (!reference) {
      reference = {
        id: randomUUID(),
        fileId: body.fileId,
        callerService: 'profile-service',
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        createdAt: new Date().toISOString(),
      };
      references.set(key, reference);
    }
    return success(response, 201, reference);
  }
  if (
    request.method === 'DELETE' &&
    request.url.startsWith('/internal/references/')
  ) {
    const id = decodeURIComponent(request.url.split('/').at(-1));
    for (const [key, reference] of references) {
      if (reference.id === id) references.delete(key);
    }
    return success(response, 200, { released: true });
  }
  if (
    request.method === 'POST' &&
    request.url === '/internal/download-url'
  ) {
    const file = resolveFile(body);
    if (!file) return json(response, 404, { code: 'MEDIA_FILE_NOT_FOUND' });
    return success(response, 200, {
      url: `https://download.example/${file.id}?token=temporary`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  }
  return json(response, 404, { code: 'NOT_FOUND' });
};

const addFile = (ownerId) => {
  const file = { id: randomUUID(), ownerId };
  files.set(file.id, file);
  return file;
};

const api = async (
  method,
  path,
  token,
  body,
  extraHeaders = {},
) => {
  const headers = { accept: 'application/json', ...extraHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
};

const expectSuccess = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.meta, null);
  return response.body.data;
};

const content = (label) => ({
  basics: { fullName: 'Candidate Builder', headline: label },
  sections: [
    { id: 'experience', entries: [{ company: 'Recruitment System' }] },
    { id: 'skills', entries: ['TypeScript', 'PostgreSQL'] },
  ],
});

const snapshot = (fileId, label, overrides = {}) => ({
  title: `${label} CV`,
  templateId: 'clean-v1',
  contentSchemaVersion: 1,
  contentJson: content(label),
  fileId,
  ...overrides,
});

const installMediaBindBarrier = (fileIds, expected = fileIds.length) => {
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  mediaBindBarrier = {
    fileIds: new Set(fileIds),
    expected,
    arrivals: 0,
    released,
    release,
  };
};

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."cv_event_outbox", "profile"."profiles" CASCADE',
  );
  mediaServer = createServer((request, response) => {
    handleMediaRequest(request, response).catch((error) =>
      json(response, 500, {
        code: 'FAKE_MEDIA_ERROR',
        message: error.message,
      }),
    );
  });
  await new Promise((resolve) =>
    mediaServer.listen(0, '127.0.0.1', resolve),
  );
  process.env.MEDIA_SERVICE_URL =
    `http://127.0.0.1:${mediaServer.address().port}`;

  const { AppModule } = require('../dist/app.module');
  const { configureApplication } = require('../dist/main');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});

after(async () => {
  try {
    if (canResetSchema) {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "profile"."cv_event_outbox", "profile"."profiles" CASCADE',
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

test('Online CV Builder publishes immutable Media-backed revisions', async (t) => {
  const tokenA = accessToken(CANDIDATE_A);
  const tokenB = accessToken(CANDIDATE_B);

  let root;
  let revision;

  await t.test('validates and publishes a versioned Online CV root', async () => {
    const invalidFile = addFile(CANDIDATE_A);
    const invalidCases = [
      snapshot(invalidFile.id, 'Version', { contentSchemaVersion: 2 }),
      snapshot(invalidFile.id, 'Array', { contentJson: [] }),
      { ...snapshot(invalidFile.id, 'Mass assignment'), userId: CANDIDATE_B },
    ];
    const beforeInvalid = mediaRequests.length;
    for (const invalid of invalidCases) {
      const response = await api('POST', '/cvs/online', tokenA, invalid);
      assert.equal(response.status, 400, JSON.stringify(response.body));
    }
    assert.equal(mediaRequests.length, beforeInvalid);

    const largeFile = addFile(CANDIDATE_B);
    const jsonbObjectOverhead = Buffer.byteLength('{"text": ""}');
    const largeContent = {
      text: 'x'.repeat(
        MAX_CV_BUILDER_CONTENT_BYTES - jsonbObjectOverhead,
      ),
    };
    const large = expectSuccess(
      await api('POST', '/cvs/online', tokenB, {
        ...snapshot(largeFile.id, 'Large'),
        contentJson: largeContent,
      }),
      201,
    );
    assert.equal(large.contentJson.text.length, largeContent.text.length);

    const overLimitFile = addFile(CANDIDATE_B);
    const mediaCallsBeforeOverLimit = mediaRequests.length;
    const overLimit = await api('POST', '/cvs/online', tokenB, {
      ...snapshot(overLimitFile.id, 'Over limit'),
      contentJson: { text: `${largeContent.text}x` },
    });
    assert.equal(overLimit.status, 400, JSON.stringify(overLimit.body));
    assert.equal(mediaRequests.length, mediaCallsBeforeOverLimit);

    const file = addFile(CANDIDATE_A);
    const requestBody = snapshot(file.id, 'Backend');
    root = expectSuccess(
      await api('POST', '/cvs/online', tokenA, requestBody),
      201,
    );
    assert.equal(root.type, 'ONLINE');
    assert.equal(root.fileId, file.id);
    assert.equal(root.fileUrl, null);
    assert.equal(root.templateId, 'clean-v1');
    assert.equal(root.contentSchemaVersion, 1);
    assert.deepEqual(root.contentJson, requestBody.contentJson);
    assert.equal(root.revisionSeriesId, root.id);
    assert.equal(root.revisionNumber, 1);
    assert.equal(root.previousRevisionId, null);
    assert.equal(root.isDefault, true);

    const persisted = await prisma.cv.findUniqueOrThrow({
      where: { id: root.id },
    });
    assert.equal(persisted.fileUrl, null);
    assert.ok(persisted.mediaReferenceId);
    assert.equal(persisted.revisionSeriesId, root.id);
    const rootEvents = await prisma.cvEventOutbox.findMany({
      where: { cvId: root.id },
    });
    assert.deepEqual(
      rootEvents.map((event) => [event.action, event.aggregateVersion]),
      [['UPSERTED', 1]],
    );
    assert.equal(rootEvents[0].payload.cv_type, 'ONLINE');
    assert.equal(rootEvents[0].payload.file_id, file.id);
    assert.equal(
      [...references.values()].find((item) => item.fileId === file.id)
        .referenceId,
      root.id,
    );

    const list = expectSuccess(await api('GET', '/cvs', tokenA));
    assert.equal(list.length, 1);
    assert.equal(list[0].type, 'ONLINE');
    assert.equal('contentJson' in list[0], false);
    const summary = expectSuccess(
      await api('GET', `/cvs/${root.id}`, tokenA),
    );
    assert.equal(summary.id, root.id);
    assert.equal('contentJson' in summary, false);
    const builder = expectSuccess(
      await api('GET', `/cv/${root.id}/builder`, tokenA),
    );
    assert.deepEqual(builder.contentJson, requestBody.contentJson);
    assert.equal(
      (await api('GET', `/cvs/${root.id}/builder`, tokenB)).status,
      404,
    );

    const beforeRetry = mediaRequests.length;
    const retry = expectSuccess(
      await api('POST', '/cv/online', tokenA, {
        ...requestBody,
        contentJson: {
          sections: requestBody.contentJson.sections,
          basics: requestBody.contentJson.basics,
        },
      }),
      201,
    );
    assert.equal(retry.id, root.id);
    assert.equal(mediaRequests.length, beforeRetry);
    assert.equal(
      await prisma.cvEventOutbox.count({ where: { cvId: root.id } }),
      1,
    );
    const conflictingRetry = await api('POST', '/cvs/online', tokenA, {
      ...requestBody,
      title: 'Different title',
    });
    assert.equal(conflictingRetry.status, 409);
    assert.equal(conflictingRetry.body.code, 'CV_FILE_ALREADY_REGISTERED');
  });

  await t.test('creates a new cvId/fileId and preserves the predecessor snapshot', async () => {
    const nextFile = addFile(CANDIDATE_A);
    const requestBody = {
      ...snapshot(nextFile.id, 'Principal'),
      expectedAggregateVersion: root.aggregateVersion,
    };
    revision = expectSuccess(
      await api(
        'POST',
        `/cvs/${root.id}/revisions`,
        tokenA,
        requestBody,
      ),
      201,
    );
    assert.notEqual(revision.id, root.id);
    assert.equal(revision.fileId, nextFile.id);
    assert.equal(revision.revisionSeriesId, root.id);
    assert.equal(revision.revisionNumber, 2);
    assert.equal(revision.previousRevisionId, root.id);
    assert.equal(revision.isDefault, true);

    const [oldRow, newRow] = await Promise.all([
      prisma.cv.findUniqueOrThrow({ where: { id: root.id } }),
      prisma.cv.findUniqueOrThrow({ where: { id: revision.id } }),
    ]);
    assert.equal(oldRow.isDeleted, true);
    assert.equal(oldRow.isDefault, false);
    assert.equal(oldRow.fileId, root.fileId);
    assert.deepEqual(oldRow.contentJson, root.contentJson);
    assert.ok(oldRow.mediaReferenceId);
    assert.equal(newRow.isDeleted, false);
    const revisionEvents = await prisma.cvEventOutbox.findMany({
      where: { cvId: { in: [root.id, revision.id] } },
      orderBy: [{ cvId: 'asc' }, { aggregateVersion: 'asc' }],
    });
    const byCv = new Map();
    for (const event of revisionEvents) {
      const values = byCv.get(event.cvId) ?? [];
      values.push([event.action, event.aggregateVersion]);
      byCv.set(event.cvId, values);
    }
    assert.deepEqual(byCv.get(root.id), [
      ['UPSERTED', 1],
      ['DEACTIVATED', 2],
    ]);
    assert.deepEqual(byCv.get(revision.id), [['UPSERTED', 1]]);
    assert.equal(
      [...references.values()].some((item) => item.fileId === root.fileId),
      true,
      'historical Media reference must be retained',
    );

    const active = expectSuccess(await api('GET', '/cvs', tokenA));
    assert.deepEqual(active.map((item) => item.id), [revision.id]);
    const historical = expectSuccess(
      await api(
        'GET',
        `/internal/v1/candidates/${CANDIDATE_A}/cvs/${root.id}`,
        null,
        undefined,
        {
          'X-Internal-Api-Key': APPLICATION_INBOUND_KEY,
          'X-Internal-Service': 'application-service',
        },
      ),
    );
    assert.equal(historical.cvId, root.id);
    assert.equal(historical.fileId, root.fileId);
    assert.equal(historical.isDeleted, true);

    const beforeRetry = mediaRequests.length;
    const retry = expectSuccess(
      await api(
        'POST',
        `/cv/${root.id}/revisions`,
        tokenA,
        requestBody,
      ),
      201,
    );
    assert.equal(retry.id, revision.id);
    assert.equal(mediaRequests.length, beforeRetry);
    assert.equal(
      await prisma.cvEventOutbox.count({
        where: { cvId: { in: [root.id, revision.id] } },
      }),
      3,
      'revision retry must not duplicate either event',
    );
    const fork = await api(
      'POST',
      `/cvs/${root.id}/revisions`,
      tokenA,
      { ...requestBody, title: 'Forked title' },
    );
    assert.equal(fork.status, 409);
    assert.equal(fork.body.code, 'CV_REVISION_ALREADY_CREATED');
  });

  await t.test('database rejects in-place snapshot and lineage mutations', async () => {
    await assert.rejects(
      () =>
        prisma.cv.update({
          where: { id: revision.id },
          data: { contentJson: content('mutated-in-place') },
        }),
      /immutable.*new revision/i,
    );
    await assert.rejects(
      () =>
        prisma.cv.update({
          where: { id: revision.id },
          data: { revisionNumber: 99 },
        }),
      /revision lineage is immutable/i,
    );

    await assert.rejects(
      () =>
        prisma.cv.create({
          data: {
            id: randomUUID(),
            userId: CANDIDATE_A,
            title: 'Invalid active predecessor',
            type: CvType.ONLINE,
            fileId: randomUUID(),
            fileUrl: null,
            mediaReferenceId: randomUUID(),
            templateId: 'clean-v1',
            contentSchemaVersion: 1,
            contentJson: content('invalid active predecessor'),
            revisionSeriesId: root.id,
            revisionNumber: revision.revisionNumber + 1,
            previousRevisionId: revision.id,
          },
        }),
      /invalid CV revision predecessor/i,
    );

    const lineageIndexes = await prisma.$queryRawUnsafe(`
      SELECT "indexname", "indexdef"
      FROM "pg_catalog"."pg_indexes"
      WHERE "schemaname" = 'profile'
        AND "indexname" IN (
          'cvs_previous_revision_id_key',
          'cvs_revision_series_number_key',
          'cvs_one_active_revision_per_series_key'
        )
    `);
    assert.equal(lineageIndexes.length, 3);
    assert.match(
      lineageIndexes.find(
        (index) =>
          index.indexname === 'cvs_one_active_revision_per_series_key',
      ).indexdef,
      /UNIQUE.*WHERE \(NOT is_deleted\)/i,
    );
  });

  await t.test('moves default transactionally when revising a non-default CV', async () => {
    const tokenC = accessToken(CANDIDATE_C);
    const uploadedFile = addFile(CANDIDATE_C);
    const uploaded = expectSuccess(
      await api('POST', '/cvs', tokenC, {
        title: 'Uploaded default',
        fileId: uploadedFile.id,
      }),
      201,
    );
    const onlineFile = addFile(CANDIDATE_C);
    const online = expectSuccess(
      await api('POST', '/cvs/online', tokenC, snapshot(onlineFile.id, 'Web')),
      201,
    );
    assert.equal(online.isDefault, false);
    const nextFile = addFile(CANDIDATE_C);
    const selected = expectSuccess(
      await api('POST', `/cvs/${online.id}/revisions`, tokenC, {
        ...snapshot(nextFile.id, 'Web v2'),
        expectedAggregateVersion: online.aggregateVersion,
        makeDefault: true,
      }),
      201,
    );
    assert.equal(selected.isDefault, true);
    const oldDefault = await prisma.cv.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    assert.equal(oldDefault.isDefault, false);
    const defaults = await prisma.cv.count({
      where: { userId: CANDIDATE_C, isDeleted: false, isDefault: true },
    });
    assert.equal(defaults, 1);
  });

  await t.test('revises safely at the five-active-CV limit', async () => {
    const sourceId = randomUUID();
    await prisma.profile.create({
      data: {
        userId: CANDIDATE_D,
        cvs: {
          create: Array.from({ length: 5 }, (_, index) => ({
            id: index === 4 ? sourceId : randomUUID(),
            title: index === 4 ? 'Online source' : `Uploaded ${index + 1}`,
            type: index === 4 ? CvType.ONLINE : CvType.UPLOAD,
            fileId: randomUUID(),
            fileUrl: null,
            mediaReferenceId: randomUUID(),
            templateId: index === 4 ? 'clean-v1' : undefined,
            contentSchemaVersion: index === 4 ? 1 : undefined,
            contentJson: index === 4 ? content('Five') : undefined,
            isDefault: index === 0,
          })),
        },
      },
    });
    const source = await prisma.cv.findUniqueOrThrow({
      where: { id: sourceId },
    });
    const replacementFile = addFile(CANDIDATE_D);
    const replacementRequest = {
      ...snapshot(replacementFile.id, 'Five v2'),
      expectedAggregateVersion: source.aggregateVersion,
    };
    const replacement = expectSuccess(
      await api(
        'POST',
        `/cvs/${source.id}/revisions`,
        accessToken(CANDIDATE_D),
        replacementRequest,
      ),
      201,
    );
    assert.equal(replacement.isDefault, false);
    const conflictingDefaultIntent = await api(
      'POST',
      `/cvs/${source.id}/revisions`,
      accessToken(CANDIDATE_D),
      { ...replacementRequest, makeDefault: true },
    );
    assert.equal(conflictingDefaultIntent.status, 409);
    assert.equal(
      conflictingDefaultIntent.body.code,
      'CV_REVISION_ALREADY_CREATED',
    );
    assert.equal(
      await prisma.cv.count({
        where: { userId: CANDIDATE_D, isDeleted: false },
      }),
      5,
    );
  });

  await t.test('bounds retained snapshots and compensates rejected Media bindings', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const deletedAt = new Date('2026-01-02T00:00:00.000Z');
    const deletedSnapshots = (count) =>
      Array.from({ length: count }, (_, index) => ({
        id: randomUUID(),
        title: `Retained snapshot ${index + 1}`,
        type: CvType.UPLOAD,
        fileId: randomUUID(),
        fileUrl: null,
        mediaReferenceId: randomUUID(),
        isDefault: false,
        isDeleted: true,
        createdAt,
        deletedAt,
      }));

    await prisma.profile.create({
      data: {
        userId: CANDIDATE_F,
        cvs: {
          create: deletedSnapshots(RETAINED_CV_SNAPSHOT_LIMIT),
        },
      },
    });
    const quotaFile = addFile(CANDIDATE_F);
    const quotaResponse = await api(
      'POST',
      '/cvs/online',
      accessToken(CANDIDATE_F),
      snapshot(quotaFile.id, 'Quota root'),
    );
    assert.equal(quotaResponse.status, 409);
    assert.equal(quotaResponse.body.code, 'CV_SNAPSHOT_LIMIT_REACHED');
    assert.equal(
      [...references.values()].some((item) => item.fileId === quotaFile.id),
      false,
      'root binding rejected by quota must be released',
    );

    const uploadedQuotaFile = addFile(CANDIDATE_F);
    const uploadedQuotaResponse = await api(
      'POST',
      '/cvs',
      accessToken(CANDIDATE_F),
      { title: 'Quota upload', fileId: uploadedQuotaFile.id },
    );
    assert.equal(uploadedQuotaResponse.status, 409);
    assert.equal(
      uploadedQuotaResponse.body.code,
      'CV_SNAPSHOT_LIMIT_REACHED',
    );
    assert.equal(
      [...references.values()].some(
        (item) => item.fileId === uploadedQuotaFile.id,
      ),
      false,
      'uploaded CV binding rejected by quota must be released',
    );

    const tokenG = accessToken(CANDIDATE_G);
    const quotaRootFile = addFile(CANDIDATE_G);
    const quotaRoot = expectSuccess(
      await api(
        'POST',
        '/cvs/online',
        tokenG,
        snapshot(quotaRootFile.id, 'Revision quota'),
      ),
      201,
    );
    await prisma.cv.createMany({
      data: deletedSnapshots(RETAINED_CV_SNAPSHOT_LIMIT - 1).map(
        (cv) => ({ ...cv, userId: CANDIDATE_G }),
      ),
    });
    const revisionQuotaFile = addFile(CANDIDATE_G);
    const revisionQuotaResponse = await api(
      'POST',
      `/cvs/${quotaRoot.id}/revisions`,
      tokenG,
      {
        ...snapshot(revisionQuotaFile.id, 'Revision over quota'),
        expectedAggregateVersion: quotaRoot.aggregateVersion,
      },
    );
    assert.equal(revisionQuotaResponse.status, 409);
    assert.equal(
      revisionQuotaResponse.body.code,
      'CV_SNAPSHOT_LIMIT_REACHED',
    );
    assert.equal(
      [...references.values()].some(
        (item) => item.fileId === revisionQuotaFile.id,
      ),
      false,
      'revision binding rejected by quota must be released',
    );
    assert.equal(
      (await prisma.cv.findUniqueOrThrow({ where: { id: quotaRoot.id } }))
        .isDeleted,
      false,
    );
  });

  await t.test('serializes concurrent revisions and releases the loser binding', async () => {
    const tokenE = accessToken(CANDIDATE_E);
    const rootFile = addFile(CANDIDATE_E);
    const raceRoot = expectSuccess(
      await api('POST', '/cvs/online', tokenE, snapshot(rootFile.id, 'Race')),
      201,
    );
    const leftFile = addFile(CANDIDATE_E);
    const rightFile = addFile(CANDIDATE_E);
    installMediaBindBarrier([leftFile.id, rightFile.id]);
    let left;
    let right;
    try {
      [left, right] = await Promise.all([
        api('POST', `/cvs/${raceRoot.id}/revisions`, tokenE, {
          ...snapshot(leftFile.id, 'Left'),
          expectedAggregateVersion: raceRoot.aggregateVersion,
        }),
        api('POST', `/cvs/${raceRoot.id}/revisions`, tokenE, {
          ...snapshot(rightFile.id, 'Right'),
          expectedAggregateVersion: raceRoot.aggregateVersion,
        }),
      ]);
    } finally {
      mediaBindBarrier = undefined;
    }
    assert.deepEqual([left.status, right.status].sort(), [201, 409]);
    const winner = left.status === 201 ? left : right;
    const loserFile = left.status === 201 ? rightFile : leftFile;
    assert.equal(
      await prisma.cv.count({ where: { previousRevisionId: raceRoot.id } }),
      1,
    );
    assert.equal(
      [...references.values()].some((item) => item.fileId === loserFile.id),
      false,
      'losing Media reference must be compensated',
    );
    assert.equal(winner.body.data.previousRevisionId, raceRoot.id);

    const tokenH = accessToken(CANDIDATE_H);
    const exactRootFile = addFile(CANDIDATE_H);
    const exactRoot = expectSuccess(
      await api(
        'POST',
        '/cvs/online',
        tokenH,
        snapshot(exactRootFile.id, 'Exact race'),
      ),
      201,
    );
    const sharedFile = addFile(CANDIDATE_H);
    const exactRequest = {
      ...snapshot(sharedFile.id, 'Exact successor'),
      expectedAggregateVersion: exactRoot.aggregateVersion,
    };
    const bindCallsBefore = mediaRequests.length;
    installMediaBindBarrier([sharedFile.id], 2);
    let exactLeft;
    let exactRight;
    try {
      [exactLeft, exactRight] = await Promise.all([
        api(
          'POST',
          `/cvs/${exactRoot.id}/revisions`,
          tokenH,
          exactRequest,
        ),
        api(
          'POST',
          `/cvs/${exactRoot.id}/revisions`,
          tokenH,
          exactRequest,
        ),
      ]);
    } finally {
      mediaBindBarrier = undefined;
    }
    assert.deepEqual([exactLeft.status, exactRight.status], [201, 201]);
    assert.equal(exactLeft.body.data.id, exactRight.body.data.id);
    assert.equal(
      await prisma.cv.count({ where: { previousRevisionId: exactRoot.id } }),
      1,
    );
    assert.equal(
      [...references.values()].filter((item) => item.fileId === sharedFile.id)
        .length,
      1,
      'exact concurrent retry must retain only the winning Media binding',
    );
    assert.equal(
      mediaRequests
        .slice(bindCallsBefore)
        .filter(
          (request) =>
            request.method === 'POST' &&
            request.url === '/internal/references' &&
            request.body.fileId === sharedFile.id,
        ).length,
      2,
      'both requests must bind before the transaction race is released',
    );
  });

  await t.test('publishes all Builder aliases and schemas in Swagger', async () => {
    const swagger = await api('GET', '/docs-json');
    assert.equal(swagger.status, 200, JSON.stringify(swagger.body));
    const operations = [
      ['/cvs/online', 'post', 'CreateOnlineCvDto'],
      ['/cv/online', 'post', 'CreateOnlineCvDto'],
      ['/cvs/{id}/builder', 'get', 'OnlineCvBuilderResponseDto'],
      ['/cv/{id}/builder', 'get', 'OnlineCvBuilderResponseDto'],
      ['/cvs/{id}/revisions', 'post', 'CreateOnlineCvRevisionDto'],
      ['/cv/{id}/revisions', 'post', 'CreateOnlineCvRevisionDto'],
    ];
    for (const [path, method, schema] of operations) {
      const operation = swagger.body.paths[path]?.[method];
      assert.ok(operation, `missing ${method.toUpperCase()} ${path}`);
      assert.match(JSON.stringify(operation), new RegExp(schema));
    }
    assert.ok(
      swagger.body.components.schemas.OnlineCvBuilderResponseDto,
      'missing OnlineCvBuilderResponseDto component',
    );
  });
});
