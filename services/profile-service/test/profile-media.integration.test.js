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
const INTERNAL_KEY = 'profile-media-integration-key-0000000000000001';
const CANDIDATE_A = '10000000-0000-4000-8000-000000000041';
const CANDIDATE_B = '10000000-0000-4000-8000-000000000042';
const CANDIDATE_C = '10000000-0000-4000-8000-000000000043';
const CANDIDATE_D = '10000000-0000-4000-8000-000000000044';
const CANDIDATE_E = '10000000-0000-4000-8000-000000000045';
const CANDIDATE_F = '10000000-0000-4000-8000-00000000004f';

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
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.MEDIA_INTERNAL_API_KEY = INTERNAL_KEY;
process.env.MEDIA_REQUEST_TIMEOUT_MS = '500';

const prisma = new PrismaClient();
const jwt = new JwtService();
const files = new Map();
const references = new Map();
const requests = [];
const releaseAttempts = new Map();
const releaseFailuresByFile = new Map();
const releaseDelayByFile = new Map();
let mediaServer;
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

const json = (response, status, data) => {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const success = (response, status, data) =>
  json(response, status, { data, meta: null });

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
    : undefined;
};

const metadata = (file, body) => ({
  id: file.id,
  ownerType: 'USER',
  ownerId: file.ownerId,
  type: file.type,
  status: file.status ?? 'ACTIVE',
  originalFilename:
    file.type === 'CV' ? 'candidate.pdf' : 'candidate.png',
  mimeType: file.type === 'CV' ? 'application/pdf' : 'image/png',
  format: file.type === 'CV' ? 'pdf' : 'png',
  bytes: 1024,
  url:
    file.type === 'CV'
      ? null
      : (file.url ?? `https://media.example/avatar/${file.id}.png`),
  privateDelivery: file.type === 'CV',
  aggregateVersion: 1,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
  ...(file.responseOverrides ?? {}),
  ...(body && file.echoRequest === true ? body : {}),
});

const resolveFile = (body) => {
  const file = files.get(body?.fileId);
  if (!file || file.ownerId !== body.expectedOwnerId) {
    return { status: 404 };
  }
  if (file.type !== body.expectedType) {
    return { status: 422 };
  }
  if ((file.status ?? 'ACTIVE') !== 'ACTIVE') {
    return { status: 409 };
  }
  if (file.upstreamStatus) {
    return { status: file.upstreamStatus };
  }
  return { file };
};

const handleMediaRequest = async (request, response) => {
  const body = await readBody(request);
  requests.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body,
  });
  if (
    request.headers['x-internal-api-key'] !== INTERNAL_KEY ||
    request.headers['x-internal-service'] !== 'profile-service'
  ) {
    return json(response, 401, { code: 'UNAUTHORIZED' });
  }

  if (request.method === 'POST' && request.url === '/internal/verify') {
    const resolved = resolveFile(body);
    if (!resolved.file) {
      return json(response, resolved.status, { code: 'MEDIA_ERROR' });
    }
    return success(response, 200, metadata(resolved.file));
  }

  if (
    request.method === 'POST' &&
    request.url === '/internal/references'
  ) {
    const resolved = resolveFile(body);
    if (!resolved.file) {
      return json(response, resolved.status, { code: 'MEDIA_ERROR' });
    }
    if (resolved.file.bindStatus) {
      return json(response, resolved.file.bindStatus, {
        code: 'MEDIA_BIND_ERROR',
      });
    }
    const key = [
      body.fileId,
      body.referenceType,
      body.referenceId,
    ].join('|');
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
    const reference = [...references.values()].find((item) => item.id === id);
    releaseAttempts.set(id, (releaseAttempts.get(id) ?? 0) + 1);
    const failures = reference
      ? (releaseFailuresByFile.get(reference.fileId) ?? 0)
      : 0;
    if ((releaseAttempts.get(id) ?? 0) <= failures) {
      return json(response, 503, { code: 'TEMPORARY' });
    }
    const delay = reference
      ? (releaseDelayByFile.get(reference.fileId) ?? 0)
      : 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (reference) {
      for (const [key, item] of references) {
        if (item.id === id) {
          references.delete(key);
        }
      }
    }
    return success(response, 200, { released: true });
  }

  if (
    request.method === 'POST' &&
    request.url === '/internal/download-url'
  ) {
    const resolved = resolveFile(body);
    if (!resolved.file) {
      return json(response, resolved.status, { code: 'MEDIA_ERROR' });
    }
    return success(response, 200, {
      url: `https://download.example/${body.fileId}?token=temporary`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  }

  return json(response, 404, { code: 'NOT_FOUND' });
};

const addFile = (ownerId, type, options = {}) => {
  const file = { id: randomUUID(), ownerId, type, ...options };
  files.set(file.id, file);
  return file;
};

const api = async (method, path, token, body) => {
  const headers = { accept: 'application/json' };
  if (token) {
    headers.authorization = 'Bearer ' + token;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
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

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."cv_event_outbox", "profile"."profiles" CASCADE',
  );

  mediaServer = createServer((request, response) => {
    handleMediaRequest(request, response).catch((error) => {
      json(response, 500, { code: 'FAKE_MEDIA_ERROR', message: error.message });
    });
  });
  await new Promise((resolve) => mediaServer.listen(0, '127.0.0.1', resolve));
  process.env.MEDIA_SERVICE_URL =
    'http://127.0.0.1:' + mediaServer.address().port;

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
        'TRUNCATE TABLE "profile"."cv_event_outbox", "profile"."profiles" CASCADE',
      );
    }
    if (app) {
      await app.close();
    }
    if (mediaServer) {
      await new Promise((resolve, reject) =>
        mediaServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('Profile avatar and uploaded CV integration', async (t) => {
  const tokenA = accessToken(CANDIDATE_A);
  const tokenB = accessToken(CANDIDATE_B);

  await t.test('routes validate JWT ownership and only accept fileId/title', async () => {
    const beforeRequests = requests.length;
    const wrongOwner = await api(
      'PUT',
      `/${CANDIDATE_B}/avatar`,
      tokenA,
      { fileId: randomUUID() },
    );
    assert.equal(wrongOwner.status, 403);
    assert.equal(wrongOwner.body.code, 'PROFILE_OWNER_REQUIRED');
    assert.equal(requests.length, beforeRequests);

    const massAssignedAvatar = await api(
      'PUT',
      `/${CANDIDATE_A}/avatar`,
      tokenA,
      { fileId: randomUUID(), url: 'https://attacker.example/avatar.png' },
    );
    assert.equal(massAssignedAvatar.status, 400);
    const massAssignedCv = await api('POST', '/cvs', tokenA, {
      title: 'Injected CV',
      fileId: randomUUID(),
      userId: CANDIDATE_B,
      fileUrl: 'https://attacker.example/cv.pdf',
      isDefault: true,
    });
    assert.equal(massAssignedCv.status, 400);
    assert.equal(
      await prisma.profile.count({ where: { userId: CANDIDATE_A } }),
      0,
    );
  });

  await t.test('invalid Media owner/type/status/URL/outage never mutates Profile', async () => {
    const wrongOwner = addFile(CANDIDATE_B, 'AVATAR');
    const wrongType = addFile(CANDIDATE_A, 'CV');
    const inactive = addFile(CANDIDATE_A, 'AVATAR', { status: 'DELETED' });
    const badUrl = addFile(CANDIDATE_A, 'AVATAR', {
      url: 'http://media.example/avatar.png',
    });
    const outage = addFile(CANDIDATE_A, 'AVATAR', { upstreamStatus: 503 });
    const cases = [
      [wrongOwner.id, 422, 'MEDIA_FILE_INVALID'],
      [wrongType.id, 422, 'MEDIA_FILE_INVALID'],
      [inactive.id, 422, 'MEDIA_FILE_INVALID'],
      [badUrl.id, 503, 'MEDIA_SERVICE_BAD_RESPONSE'],
      [outage.id, 503, 'MEDIA_SERVICE_UNAVAILABLE'],
    ];
    for (const [fileId, status, code] of cases) {
      const response = await api(
        'PUT',
        `/${CANDIDATE_A}/avatar`,
        tokenA,
        { fileId },
      );
      assert.equal(response.status, status, JSON.stringify(response.body));
      assert.equal(response.body.code, code);
    }

    const invalidCvCases = [
      [addFile(CANDIDATE_B, 'CV'), 422, 'MEDIA_FILE_INVALID'],
      [addFile(CANDIDATE_A, 'AVATAR'), 422, 'MEDIA_FILE_INVALID'],
      [addFile(CANDIDATE_A, 'CV', { status: 'DELETED' }), 422, 'MEDIA_FILE_INVALID'],
      [
        addFile(CANDIDATE_A, 'CV', {
          responseOverrides: {
            url: 'https://media.example/private-cv-must-not-be-public.pdf',
          },
        }),
        503,
        'MEDIA_SERVICE_BAD_RESPONSE',
      ],
      [addFile(CANDIDATE_A, 'CV', { upstreamStatus: 503 }), 503, 'MEDIA_SERVICE_UNAVAILABLE'],
      [addFile(CANDIDATE_A, 'CV', { bindStatus: 503 }), 503, 'MEDIA_SERVICE_UNAVAILABLE'],
    ];
    for (const [file, status, code] of invalidCvCases) {
      const response = await api('POST', '/cvs', tokenA, {
        title: 'Rejected CV',
        fileId: file.id,
      });
      assert.equal(response.status, status, JSON.stringify(response.body));
      assert.equal(response.body.code, code);
    }
    assert.equal(
      await prisma.profile.count({ where: { userId: CANDIDATE_A } }),
      0,
    );
    assert.equal(await prisma.cv.count({ where: { userId: CANDIDATE_A } }), 0);
  });

  await t.test('UUID inputs are canonicalized case-insensitively', async () => {
    const tokenF = accessToken(CANDIDATE_F);
    const avatar = addFile(CANDIDATE_F, 'AVATAR');
    const attached = expectSuccess(
      await api('PUT', `/${CANDIDATE_F.toUpperCase()}/avatar`, tokenF, {
        fileId: avatar.id.toUpperCase(),
      }),
    );
    assert.equal(attached.userId, CANDIDATE_F);
    assert.equal(attached.avatarFileId, avatar.id);

    const cv = addFile(CANDIDATE_F, 'CV');
    const created = expectSuccess(
      await api('POST', '/cvs', tokenF, {
        title: 'Uppercase UUID CV',
        fileId: cv.id.toUpperCase(),
      }),
      201,
    );
    assert.equal(created.fileId, cv.id);
  });

  await t.test('attaches, replaces and removes avatar with post-commit release', async () => {
    const first = addFile(CANDIDATE_A, 'AVATAR');
    const second = addFile(CANDIDATE_A, 'AVATAR');
    const attached = expectSuccess(
      await api('PUT', `/${CANDIDATE_A}/avatar`, tokenA, {
        fileId: first.id,
      }),
    );
    assert.equal(attached.avatarFileId, first.id);
    assert.equal(attached.avatarUrl, first.url ?? `https://media.example/avatar/${first.id}.png`);
    assert.equal(attached.completionRuleVersion, 1);

    const repeated = expectSuccess(
      await api('PUT', `/${CANDIDATE_A}/avatar`, tokenA, {
        fileId: first.id,
      }),
    );
    assert.equal(repeated.aggregateVersion, attached.aggregateVersion);
    assert.equal(repeated.updatedAt, attached.updatedAt);

    const firstReference = [...references.values()].find(
      (item) => item.fileId === first.id,
    );
    assert.ok(firstReference);
    const persisted = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(persisted.avatarMediaReferenceId, firstReference.id);

    const replaced = expectSuccess(
      await api('PUT', `/${CANDIDATE_A}/avatar`, tokenA, {
        fileId: second.id,
      }),
    );
    assert.equal(replaced.avatarFileId, second.id);
    assert.equal(
      [...references.values()].some((item) => item.fileId === first.id),
      false,
    );
    assert.equal(releaseAttempts.get(firstReference.id), 1);

    const secondReference = [...references.values()].find(
      (item) => item.fileId === second.id,
    );
    const removed = expectSuccess(
      await api('DELETE', `/${CANDIDATE_A}/avatar`, tokenA),
    );
    assert.equal(removed.avatarFileId, null);
    assert.equal(removed.avatarUrl, null);
    assert.equal(releaseAttempts.get(secondReference.id), 1);
    const repeatedRemoval = expectSuccess(
      await api('DELETE', `/${CANDIDATE_A}/avatar`, tokenA),
    );
    assert.equal(repeatedRemoval.aggregateVersion, removed.aggregateVersion);
    assert.equal(repeatedRemoval.updatedAt, removed.updatedAt);

    const verifyRequest = requests.find(
      (item) => item.url === '/internal/verify' && item.body.fileId === first.id,
    );
    assert.equal(verifyRequest.headers['x-internal-api-key'], INTERNAL_KEY);
    assert.equal(verifyRequest.headers['x-internal-service'], 'profile-service');
    assert.deepEqual(verifyRequest.body, {
      expectedOwnerId: CANDIDATE_A,
      expectedOwnerType: 'USER',
      expectedType: 'AVATAR',
      fileId: first.id,
    });
  });

  await t.test('concurrent avatar delete and reattach cannot reuse a released reference', async () => {
    const tokenD = accessToken(CANDIDATE_D);
    const file = addFile(CANDIDATE_D, 'AVATAR');
    expectSuccess(
      await api('PUT', `/${CANDIDATE_D}/avatar`, tokenD, {
        fileId: file.id,
      }),
    );
    const oldReference = [...references.values()].find(
      (item) => item.fileId === file.id,
    );
    assert.ok(oldReference);
    releaseDelayByFile.set(file.id, 200);

    const deletion = api('DELETE', `/${CANDIDATE_D}/avatar`, tokenD);
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const profile = await prisma.profile.findUniqueOrThrow({
        where: { userId: CANDIDATE_D },
      });
      if (profile.avatarFileId === null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const cleared = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_D },
    });
    assert.equal(cleared.avatarFileId, null, 'DELETE did not commit in time');

    const reattachment = api('PUT', `/${CANDIDATE_D}/avatar`, tokenD, {
      fileId: file.id,
    });
    const [deleted, reattached] = await Promise.all([deletion, reattachment]);
    expectSuccess(deleted);
    const current = expectSuccess(reattached);
    assert.equal(current.avatarFileId, file.id);
    const row = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_D },
    });
    const newReference = [...references.values()].find(
      (item) => item.fileId === file.id,
    );
    assert.ok(newReference);
    assert.notEqual(newReference.id, oldReference.id);
    assert.equal(row.avatarMediaReferenceId, newReference.id);
    assert.equal(
      [...references.values()].some((item) => item.id === oldReference.id),
      false,
    );
    releaseDelayByFile.delete(file.id);
  });

  await t.test('keeps uploaded CV private and exposes download only on demand', async () => {
    const file = addFile(CANDIDATE_A, 'CV');
    const created = expectSuccess(
      await api('POST', '/cvs', tokenA, {
        title: '  Backend CV  ',
        fileId: file.id,
      }),
      201,
    );
    assert.equal(created.title, 'Backend CV');
    assert.equal(created.fileUrl, null);
    assert.equal(created.isDefault, true);
    const row = await prisma.cv.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.fileUrl, null);
    assert.ok(row.mediaReferenceId);
    const createdEvent = await prisma.cvEventOutbox.findFirstOrThrow({
      where: { cvId: created.id },
    });
    assert.equal(createdEvent.action, 'UPSERTED');
    assert.equal(createdEvent.aggregateVersion, 1);
    assert.equal(createdEvent.eventKey, created.id);
    assert.deepEqual(Object.keys(createdEvent.payload).sort(), [
      'action',
      'aggregate_version',
      'candidate_id',
      'cv_id',
      'cv_type',
      'event_id',
      'file_id',
      'occurred_at',
      'schema_version',
    ]);
    assert.equal(createdEvent.payload.candidate_id, CANDIDATE_A);
    assert.equal(createdEvent.payload.file_id, file.id);
    assert.equal(createdEvent.payload.cv_type, 'UPLOAD');
    assert.equal(createdEvent.payload.schema_version, 1);
    assert.equal(
      [...references.values()].find((item) => item.fileId === file.id)
        .referenceType,
      'PROFILE_CV',
    );
    assert.equal(
      [...references.values()].find((item) => item.fileId === file.id)
        .referenceId,
      created.id,
    );

    const list = expectSuccess(await api('GET', '/cvs', tokenA));
    assert.equal(list.length, 1);
    assert.equal(list[0].fileUrl, null);
    assert.equal(JSON.stringify(list).includes('download.example'), false);
    const detail = expectSuccess(
      await api('GET', `/cv/${created.id}`, tokenA),
    );
    assert.equal(detail.id, created.id);
    assert.equal(detail.fileUrl, null);

    const download = expectSuccess(
      await api('POST', `/cvs/${created.id}/download-url`, tokenA),
    );
    assert.match(download.url, /^https:\/\/download\.example\//);
    assert.ok(Date.parse(download.expiresAt) > Date.now());
    const afterDownload = await prisma.cv.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.equal(afterDownload.fileUrl, null);

    const downloadCalls = requests.filter(
      (item) => item.url === '/internal/download-url',
    ).length;
    const idorDetail = await api('GET', `/cvs/${created.id}`, tokenB);
    const idorDownload = await api(
      'POST',
      `/cvs/${created.id}/download-url`,
      tokenB,
    );
    assert.equal(idorDetail.status, 404);
    assert.equal(idorDownload.status, 404);
    assert.equal(
      requests.filter((item) => item.url === '/internal/download-url').length,
      downloadCalls,
    );

    const beforeVersion = (
      await prisma.profile.findUniqueOrThrow({
        where: { userId: CANDIDATE_A },
      })
    ).aggregateVersion;
    const requestsBeforeDuplicate = requests.length;
    const duplicate = expectSuccess(
      await api('POST', '/cv', tokenA, {
        title: 'Backend CV',
        fileId: file.id,
      }),
      201,
    );
    assert.equal(duplicate.id, created.id);
    assert.equal(
      requests.length,
      requestsBeforeDuplicate,
      'ordinary idempotent retry must not call Media again',
    );
    assert.equal(await prisma.cv.count({ where: { fileId: file.id } }), 1);
    assert.equal(
      await prisma.cvEventOutbox.count({ where: { cvId: created.id } }),
      1,
      'idempotent create retry must not append another event',
    );
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_A },
        })
      ).aggregateVersion,
      beforeVersion,
    );
    const renamedDuplicate = await api('POST', '/cvs', tokenA, {
      title: 'Different title',
      fileId: file.id,
    });
    assert.equal(renamedDuplicate.status, 409);
    assert.equal(renamedDuplicate.body.code, 'CV_FILE_ALREADY_REGISTERED');
    assert.ok([...references.values()].some((item) => item.fileId === file.id));
  });

  await t.test('legacy and ONLINE CV rows cannot masquerade as uploaded bindings', async () => {
    const legacyFile = addFile(CANDIDATE_B, 'CV');
    const onlineFileId = randomUUID();
    await prisma.profile.create({
      data: {
        userId: CANDIDATE_B,
        cvs: {
          create: [
            {
              title: 'Legacy upload',
              type: CvType.UPLOAD,
              fileId: legacyFile.id,
              fileUrl: `https://legacy.example/${legacyFile.id}.pdf`,
              isDefault: true,
            },
            {
              title: 'Builder CV',
              type: CvType.ONLINE,
              fileId: onlineFileId,
              fileUrl: `https://legacy.example/${onlineFileId}.pdf`,
              templateId: 'legacy-builder-v1',
              contentJson: { basics: { fullName: 'Candidate B' } },
              contentSchemaVersion: 1,
            },
          ],
        },
      },
    });
    const legacy = await prisma.cv.findUniqueOrThrow({
      where: { fileId: legacyFile.id },
    });
    const online = await prisma.cv.findUniqueOrThrow({
      where: { fileId: onlineFileId },
    });

    const conflict = await api('POST', '/cvs', tokenB, {
      title: 'Legacy upload',
      fileId: legacyFile.id,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'CV_FILE_ALREADY_REGISTERED');
    assert.equal(
      [...references.values()].some((item) => item.fileId === legacyFile.id),
      false,
    );

    const list = expectSuccess(await api('GET', '/cvs', tokenB));
    assert.equal(list.length, 0);
    const legacyDetail = await api('GET', `/cvs/${legacy.id}`, tokenB);
    const onlineDetail = await api('GET', `/cvs/${online.id}`, tokenB);
    assert.equal(legacyDetail.status, 404);
    assert.equal(onlineDetail.status, 404);
  });

  await t.test('enforces five CVs under lock and retries compensation release', async () => {
    const existing = await prisma.cv.count({
      where: { userId: CANDIDATE_A, isDeleted: false },
    });
    for (let index = existing; index < 5; index += 1) {
      const file = addFile(CANDIDATE_A, 'CV');
      expectSuccess(
        await api('POST', '/cvs', tokenA, {
          title: `CV ${index + 1}`,
          fileId: file.id,
        }),
        201,
      );
    }
    const overflow = addFile(CANDIDATE_A, 'CV');
    releaseFailuresByFile.set(overflow.id, 2);
    const rejected = await api('POST', '/cvs', tokenA, {
      title: 'Overflow CV',
      fileId: overflow.id,
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'CV_LIMIT_REACHED');
    assert.equal(
      await prisma.cv.count({ where: { userId: CANDIDATE_A, isDeleted: false } }),
      5,
    );
    const overflowReferenceRequest = requests.findLast(
      (item) =>
        item.url === '/internal/references' && item.body.fileId === overflow.id,
    );
    assert.ok(overflowReferenceRequest);
    assert.equal(
      [...references.values()].some((item) => item.fileId === overflow.id),
      false,
    );
    const releasedIds = [...releaseAttempts.entries()].filter(
      ([referenceId]) =>
        ![...references.values()].some((item) => item.id === referenceId),
    );
    assert.ok(releasedIds.some(([, attempts]) => attempts === 3));
  });

  await t.test('six concurrent registrations yield five successes and one conflict', async () => {
    await prisma.profile.create({ data: { userId: CANDIDATE_C } });
    const initialVersion = 1;
    const tokenC = accessToken(CANDIDATE_C);
    const concurrentFiles = Array.from({ length: 6 }, () =>
      addFile(CANDIDATE_C, 'CV'),
    );
    const results = await Promise.all(
      concurrentFiles.map((file, index) =>
        api('POST', '/cvs', tokenC, {
          title: `Concurrent CV ${index + 1}`,
          fileId: file.id,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.status === 201).length, 5);
    const conflicts = results.filter((result) => result.status === 409);
    assert.equal(conflicts.length, 1, JSON.stringify(results));
    assert.equal(conflicts[0].body.code, 'CV_LIMIT_REACHED');
    const rows = await prisma.cv.findMany({
      where: { userId: CANDIDATE_C, isDeleted: false },
    });
    assert.equal(rows.length, 5);
    assert.equal(rows.filter((row) => row.isDefault).length, 1);
    assert.equal(rows.every((row) => row.fileUrl === null), true);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_C },
        })
      ).aggregateVersion,
      initialVersion + 5,
    );
    assert.equal(
      concurrentFiles.filter((file) =>
        [...references.values()].some((item) => item.fileId === file.id),
      ).length,
      5,
    );
  });

  await t.test('concurrent duplicate CV posts converge and release losing bindings', async () => {
    await prisma.profile.create({ data: { userId: CANDIDATE_E } });
    const tokenE = accessToken(CANDIDATE_E);
    const file = addFile(CANDIDATE_E, 'CV');
    const releasesBefore = releaseAttempts.size;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api('POST', '/cvs', tokenE, {
          title: 'Concurrent duplicate CV',
          fileId: file.id,
        }),
      ),
    );
    assert.equal(results.every((result) => result.status === 201), true);
    const ids = new Set(results.map((result) => result.body.data.id));
    assert.equal(ids.size, 1);
    const cvId = [...ids][0];
    assert.equal(
      await prisma.cv.count({ where: { userId: CANDIDATE_E } }),
      1,
    );
    const activeReferences = [...references.values()].filter(
      (item) => item.fileId === file.id,
    );
    assert.equal(activeReferences.length, 1);
    assert.equal(activeReferences[0].referenceId, cvId);
    const bindCalls = requests.filter(
      (item) =>
        item.url === '/internal/references' && item.body.fileId === file.id,
    ).length;
    assert.ok(bindCalls >= 2, 'test did not exercise concurrent bindings');
    assert.equal(releaseAttempts.size - releasesBefore, bindCalls - 1);
    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_E },
    });
    assert.equal(profile.aggregateVersion, 2);
  });

  await t.test('Swagger publishes canonical and compatibility routes', async () => {
    const swagger = await api('GET', '/docs-json');
    assert.equal(swagger.status, 200);
    for (const path of [
      '/{userId}/avatar',
      '/cvs',
      '/cv',
      '/cvs/{id}',
      '/cv/{id}',
      '/cvs/{id}/download-url',
      '/cv/{id}/download-url',
    ]) {
      assert.ok(swagger.body.paths[path], `missing Swagger path ${path}`);
    }
  });
});
