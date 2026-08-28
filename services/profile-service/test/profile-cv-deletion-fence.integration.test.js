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
const {
  CvDeletionState,
  CvMediaCleanupStatus,
  CvType,
  PrismaClient,
} = require('@prisma/client');
const { assertSafeTestDatabase } = require('./test-database-safety');

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const APPLICATION_OUTBOUND_KEY =
  'profile-fence-to-application-key-000000000001';
const APPLICATION_INBOUND_KEY =
  'application-fence-to-profile-key-000000000001';
const MEDIA_KEY = 'profile-fence-media-key-000000000000000001';

const USER_HARD = '31000000-0000-4000-8000-000000000001';
const USER_RETRY = '31000000-0000-4000-8000-000000000002';
const USER_PENDING = '31000000-0000-4000-8000-000000000003';
const CV_HARD = '32000000-0000-4000-8000-000000000001';
const CV_KEEP = '32000000-0000-4000-8000-000000000002';
const CV_RETRY = '32000000-0000-4000-8000-000000000003';
const CV_RETRY_KEEP = '32000000-0000-4000-8000-000000000004';
const CV_PENDING = '32000000-0000-4000-8000-000000000005';
const CV_PENDING_KEEP = '32000000-0000-4000-8000-000000000006';
const FILE_HARD = '33000000-0000-4000-8000-000000000001';
const FILE_KEEP = '33000000-0000-4000-8000-000000000002';
const FILE_RETRY = '33000000-0000-4000-8000-000000000003';
const FILE_RETRY_KEEP = '33000000-0000-4000-8000-000000000004';
const FILE_PENDING = '33000000-0000-4000-8000-000000000005';
const FILE_PENDING_KEEP = '33000000-0000-4000-8000-000000000006';
const REF_HARD = '34000000-0000-4000-8000-000000000001';
const REF_KEEP = '34000000-0000-4000-8000-000000000002';
const REF_RETRY = '34000000-0000-4000-8000-000000000003';
const REF_RETRY_KEEP = '34000000-0000-4000-8000-000000000004';
const REF_PENDING = '34000000-0000-4000-8000-000000000005';
const REF_PENDING_KEEP = '34000000-0000-4000-8000-000000000006';

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
process.env.INTERNAL_API_KEY_APPLICATION = APPLICATION_INBOUND_KEY;
process.env.APPLICATION_INTERNAL_API_KEY = APPLICATION_OUTBOUND_KEY;
process.env.APPLICATION_REQUEST_TIMEOUT_MS = '500';
process.env.MEDIA_INTERNAL_API_KEY = MEDIA_KEY;
process.env.MEDIA_REQUEST_TIMEOUT_MS = '500';
process.env.CV_DELETION_RECONCILE_ENABLED = 'false';
process.env.CV_MEDIA_CLEANUP_ENABLED = 'false';

const prisma = new PrismaClient();
const jwt = new JwtService();
const applicationCalls = [];
const mediaCalls = [];
const fileOwners = new Map([
  [FILE_HARD, USER_HARD],
  [FILE_KEEP, USER_HARD],
  [FILE_RETRY, USER_RETRY],
  [FILE_RETRY_KEEP, USER_RETRY],
  [FILE_PENDING, USER_PENDING],
  [FILE_PENDING_KEEP, USER_PENDING],
]);
const failedDeleteBudget = new Map([[FILE_RETRY, 1]]);
let applicationServer;
let mediaServer;
let app;
let baseUrl;
let canResetSchema = false;
let pendingFenceAvailable = false;

const token = (subject) =>
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

const metadata = (fileId, ownerId, status) => ({
  aggregateVersion: status === 'DELETED' ? 2 : 1,
  bytes: 1024,
  createdAt: '2026-08-27T01:00:00.000Z',
  format: 'pdf',
  id: fileId,
  mimeType: 'application/pdf',
  originalFilename: 'candidate.pdf',
  ownerId,
  ownerType: 'USER',
  privateDelivery: true,
  status,
  type: 'CV',
  updatedAt:
    status === 'DELETED'
      ? '2026-08-28T02:00:00.000Z'
      : '2026-08-27T01:00:00.000Z',
  url: null,
});

const handleApplication = async (request, response) => {
  const body = await readBody(request);
  applicationCalls.push({ method: request.method, url: request.url, body });
  if (
    request.headers['x-internal-api-key'] !== APPLICATION_OUTBOUND_KEY ||
    request.headers['x-internal-service'] !== 'profile-service'
  ) {
    return json(response, 401, { code: 'UNAUTHORIZED' });
  }
  if (
    request.method !== 'POST' ||
    request.url !== '/internal/v1/cv-deletion-fences/acquire'
  ) {
    return json(response, 404, { code: 'NOT_FOUND' });
  }
  if (body.cvId === CV_PENDING && !pendingFenceAvailable) {
    return json(response, 503, { code: 'OUTAGE' });
  }
  return json(response, 200, {
    data: {
      candidateId: body.candidateId,
      cvId: body.cvId,
      deletionRequestId: body.deletionRequestId,
      disposition: 'FENCED',
      fencedAt: '2026-08-28T01:00:00.000Z',
      firstUsedAt: null,
      applicationCount: 0,
    },
    meta: null,
  });
};

const handleMedia = async (request, response) => {
  const body = await readBody(request);
  mediaCalls.push({ method: request.method, url: request.url, body });
  if (
    request.headers['x-internal-api-key'] !== MEDIA_KEY ||
    request.headers['x-internal-service'] !== 'profile-service'
  ) {
    return json(response, 401, { code: 'UNAUTHORIZED' });
  }
  if (request.method === 'POST' && request.url === '/internal/verify') {
    const ownerId = fileOwners.get(body.fileId);
    return json(response, 200, {
      data: metadata(body.fileId, ownerId, 'ACTIVE'),
      meta: null,
    });
  }
  if (
    request.method === 'POST' &&
    request.url === '/internal/references'
  ) {
    return json(response, 201, {
      data: {
        id: randomUUID(),
        fileId: body.fileId,
        callerService: 'profile-service',
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        createdAt: '2026-08-28T01:00:00.000Z',
      },
      meta: null,
    });
  }
  if (
    request.method === 'DELETE' &&
    request.url.startsWith('/internal/references/')
  ) {
    return json(response, 200, { data: { released: true }, meta: null });
  }
  if (
    request.method === 'DELETE' &&
    request.url.startsWith('/internal/files/')
  ) {
    const fileId = decodeURIComponent(request.url.split('/').at(-1));
    const remaining = failedDeleteBudget.get(fileId) ?? 0;
    if (remaining > 0) {
      failedDeleteBudget.set(fileId, remaining - 1);
      return json(response, 503, { code: 'TEMPORARY_FAILURE' });
    }
    return json(response, 200, {
      data: metadata(fileId, fileOwners.get(fileId), 'DELETED'),
      meta: null,
    });
  }
  return json(response, 404, { code: 'NOT_FOUND' });
};

const startServer = async (handler) => {
  const server = createServer((request, response) => {
    handler(request, response).catch((error) =>
      json(response, 500, { code: 'FAKE_ERROR', message: error.message }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

const api = async (method, path, bearer, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const cv = (id, fileId, mediaReferenceId, isDefault, createdAt) => ({
  id,
  title: id,
  type: CvType.UPLOAD,
  fileId,
  fileUrl: null,
  mediaReferenceId,
  isDefault,
  createdAt: new Date(createdAt),
});

const createProfile = (userId, cvs) =>
  prisma.profile.create({ data: { userId, cvs: { create: cvs } } });

const closeServer = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "profile"."profiles" CASCADE');

  applicationServer = await startServer(handleApplication);
  mediaServer = await startServer(handleMedia);
  process.env.APPLICATION_SERVICE_URL =
    `http://127.0.0.1:${applicationServer.address().port}`;
  process.env.MEDIA_SERVICE_URL =
    `http://127.0.0.1:${mediaServer.address().port}`;

  await createProfile(USER_HARD, [
    cv(CV_HARD, FILE_HARD, REF_HARD, true, '2026-08-27T01:00:00Z'),
    cv(CV_KEEP, FILE_KEEP, REF_KEEP, false, '2026-08-27T02:00:00Z'),
  ]);
  await createProfile(USER_RETRY, [
    cv(CV_RETRY_KEEP, FILE_RETRY_KEEP, REF_RETRY_KEEP, true, '2026-08-27T01:00:00Z'),
    cv(CV_RETRY, FILE_RETRY, REF_RETRY, false, '2026-08-27T02:00:00Z'),
  ]);
  await createProfile(USER_PENDING, [
    cv(CV_PENDING_KEEP, FILE_PENDING_KEEP, REF_PENDING_KEEP, true, '2026-08-27T01:00:00Z'),
    cv(CV_PENDING, FILE_PENDING, REF_PENDING, false, '2026-08-27T02:00:00Z'),
  ]);

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
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "profile"."profiles" CASCADE');
    }
    if (app) await app.close();
    if (applicationServer) await closeServer(applicationServer);
    if (mediaServer) await closeServer(mediaServer);
  } finally {
    await prisma.$disconnect();
  }
});

test('unused CV hard-delete is fenced, audited, cleanup-safe, idempotent, and retires its file', async () => {
  const appCallsBefore = applicationCalls.length;
  const response = await api('DELETE', `/cvs/${CV_HARD}`, token(USER_HARD), {
    expectedAggregateVersion: 1,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(
    {
      id: response.body.data.id,
      deletionMode: response.body.data.deletionMode,
      replacementDefaultCvId: response.body.data.replacementDefaultCvId,
      aggregateVersion: response.body.data.aggregateVersion,
      cleanupPending: response.body.data.cleanupPending,
    },
    {
      id: CV_HARD,
      deletionMode: 'HARD',
      replacementDefaultCvId: CV_KEEP,
      aggregateVersion: 2,
      cleanupPending: false,
    },
  );
  assert.equal(await prisma.cv.findUnique({ where: { id: CV_HARD } }), null);
  const replacement = await prisma.cv.findUniqueOrThrow({ where: { id: CV_KEEP } });
  assert.equal(replacement.isDefault, true);
  assert.equal(replacement.aggregateVersion, 2);
  const workflow = await prisma.cvDeletionWorkflow.findUniqueOrThrow({
    where: { cvId: CV_HARD },
    include: { cleanup: true },
  });
  assert.equal(workflow.state, CvDeletionState.HARD_DELETED);
  assert.equal(workflow.fileId, FILE_HARD);
  assert.equal(workflow.mediaReferenceId, REF_HARD);
  assert.equal(workflow.cleanup.status, CvMediaCleanupStatus.SUCCEEDED);
  assert.equal(applicationCalls.length, appCallsBefore + 1);

  const retry = await api('DELETE', `/cvs/${CV_HARD}`, token(USER_HARD), {
    expectedAggregateVersion: 1,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.deletionMode, 'HARD');
  assert.equal(retry.body.data.cleanupPending, false);
  assert.equal(applicationCalls.length, appCallsBefore + 1);

  const bindCallsBefore = mediaCalls.filter(
    (call) => call.method === 'POST' && call.url === '/internal/references',
  ).length;
  const retired = await api('POST', '/cvs', token(USER_HARD), {
    title: 'Must stay retired',
    fileId: FILE_HARD,
  });
  assert.equal(retired.status, 409, JSON.stringify(retired.body));
  assert.equal(retired.body.code, 'CV_FILE_RETIRED');
  assert.equal(
    mediaCalls.filter(
      (call) => call.method === 'POST' && call.url === '/internal/references',
    ).length,
    bindCallsBefore,
    'retired check runs after ownership verification but before binding',
  );
  await assert.rejects(
    () =>
      prisma.cv.create({
        data: {
          ...cv(randomUUID(), FILE_HARD, randomUUID(), false, new Date()),
          userId: USER_HARD,
        },
      }),
    /retired CV file cannot be registered again/i,
  );
});

test('Media outage leaves a durable retry and the worker resumes after reference release without releasing twice', async () => {
  const response = await api('DELETE', `/cvs/${CV_RETRY}`, token(USER_RETRY), {
    expectedAggregateVersion: 1,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.deletionMode, 'HARD');
  assert.equal(response.body.data.cleanupPending, true);
  let job = await prisma.cvMediaCleanupJob.findUniqueOrThrow({
    where: { cvId: CV_RETRY },
  });
  assert.equal(job.status, CvMediaCleanupStatus.RETRY);
  assert.notEqual(job.referenceReleasedAt, null);
  assert.equal(job.fileDeletedAt, null);

  const releasesBefore = mediaCalls.filter(
    (call) => call.method === 'DELETE' && call.url.endsWith(REF_RETRY),
  ).length;
  await prisma.cvMediaCleanupJob.update({
    where: { cvId: CV_RETRY },
    data: { nextAttemptAt: new Date(0) },
  });
  const { CvMediaCleanupService } = require('../dist/profile/cv-media-cleanup.service');
  assert.equal(await app.get(CvMediaCleanupService).runOnce(), 1);
  job = await prisma.cvMediaCleanupJob.findUniqueOrThrow({
    where: { cvId: CV_RETRY },
  });
  assert.equal(job.status, CvMediaCleanupStatus.SUCCEEDED);
  assert.notEqual(job.fileDeletedAt, null);
  assert.equal(
    mediaCalls.filter(
      (call) => call.method === 'DELETE' && call.url.endsWith(REF_RETRY),
    ).length,
    releasesBefore,
  );
});

test('pending fence survives Application outage and direct SQL cannot forge authorization or hard-delete', async () => {
  const response = await api('DELETE', `/cvs/${CV_PENDING}`, token(USER_PENDING), {
    expectedAggregateVersion: 1,
  });
  assert.equal(response.status, 202, JSON.stringify(response.body));
  assert.equal(response.body.data.deletionMode, 'PENDING');
  assert.equal(response.body.data.cleanupPending, false);
  const workflow = await prisma.cvDeletionWorkflow.findUniqueOrThrow({
    where: { cvId: CV_PENDING },
  });
  assert.equal(workflow.state, CvDeletionState.PENDING_FENCE);
  const row = await prisma.cv.findUniqueOrThrow({ where: { id: CV_PENDING } });
  assert.equal(row.isDeleted, true);
  assert.equal(row.aggregateVersion, 2);
  const initialFenceCalls = applicationCalls.filter(
    (call) => call.body?.cvId === CV_PENDING,
  );
  assert.equal(initialFenceCalls.length, 1);
  assert.equal(
    initialFenceCalls[0].body.deletionRequestId,
    workflow.deletionRequestId,
  );

  const pendingRetry = await api(
    'DELETE',
    `/cvs/${CV_PENDING}`,
    token(USER_PENDING),
    { expectedAggregateVersion: response.body.data.aggregateVersion },
  );
  assert.equal(pendingRetry.status, 202);
  assert.equal(pendingRetry.body.data.deletionMode, 'PENDING');
  assert.equal(pendingRetry.body.data.deletedAt, response.body.data.deletedAt);
  assert.equal(
    applicationCalls.filter((call) => call.body?.cvId === CV_PENDING).length,
    1,
    'a retry before fenceNextAttemptAt must not bypass backoff',
  );

  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(`
        UPDATE "profile"."cv_deletion_workflow"
        SET "state" = 'HARD_DELETE_AUTHORIZED',
            "fenced_at" = clock_timestamp()
        WHERE "cv_id" = '${CV_PENDING}'::uuid
      `),
    /transaction fence/i,
  );
  await assert.rejects(
    () =>
      prisma.$transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(
          `SELECT set_config('profile.cv_deletion_request_id', '${workflow.deletionRequestId}', true)`,
        );
        const updated = await transaction.$executeRawUnsafe(`
          UPDATE "profile"."cv_deletion_workflow"
          SET "state" = 'HARD_DELETE_AUTHORIZED',
              "fenced_at" = clock_timestamp()
          WHERE "cv_id" = '${CV_PENDING}'::uuid
        `);
        assert.equal(updated, 1);
        // Prisma 5.x can swallow a deferred-COMMIT error even though
        // PostgreSQL rolls the transaction back, so force this exact
        // constraint checkpoint to make the database rejection observable.
        await transaction.$executeRawUnsafe(
          'SET CONSTRAINTS "profile"."cv_deletion_workflow_no_durable_authorization" IMMEDIATE',
        );
      }),
    /authorization cannot be committed/i,
  );
  await assert.rejects(
    () =>
      prisma.$transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(
          `SELECT set_config('profile.cv_deletion_request_id', '${workflow.deletionRequestId}', true)`,
        );
        await transaction.$executeRawUnsafe(`
          UPDATE "profile"."cv_deletion_workflow"
          SET "state" = 'HARD_DELETE_AUTHORIZED',
              "fenced_at" = clock_timestamp()
          WHERE "cv_id" = '${CV_PENDING}'::uuid
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "profile"."cv_media_cleanup_job"
            ("id", "cv_id", "user_id", "file_id", "media_reference_id")
          VALUES
            ('35000000-0000-4000-8000-000000000001',
             '${CV_PENDING}', '${USER_PENDING}', '${FILE_PENDING}', '${REF_PENDING}')
        `);
        await transaction.$queryRawUnsafe(
          `SELECT set_config('profile.cv_deletion_request_id', '${randomUUID()}', true)`,
        );
        await transaction.$executeRawUnsafe(
          `DELETE FROM "profile"."cvs" WHERE "id" = '${CV_PENDING}'::uuid`,
        );
      }),
    /authoritative CV deletion fence/i,
  );
  assert.equal(
    (await prisma.cvDeletionWorkflow.findUniqueOrThrow({ where: { cvId: CV_PENDING } })).state,
    CvDeletionState.PENDING_FENCE,
  );
  assert.equal(
    await prisma.cvMediaCleanupJob.findUnique({ where: { cvId: CV_PENDING } }),
    null,
  );
  const { CvMediaCleanupService } = require('../dist/profile/cv-media-cleanup.service');
  assert.equal(await app.get(CvMediaCleanupService).tryCleanupCv(CV_PENDING), false);

  pendingFenceAvailable = true;
  await prisma.cvDeletionWorkflow.update({
    where: { cvId: CV_PENDING },
    data: { fenceNextAttemptAt: new Date(0) },
  });
  const { CvDeletionService } = require('../dist/profile/cv-deletion.service');
  assert.equal(await app.get(CvDeletionService).runOnce(), 1);
  const completed = await prisma.cvDeletionWorkflow.findUniqueOrThrow({
    where: { cvId: CV_PENDING },
    include: { cleanup: true },
  });
  assert.equal(completed.state, CvDeletionState.HARD_DELETED);
  assert.equal(completed.deletionRequestId, workflow.deletionRequestId);
  assert.equal(completed.cleanup.status, CvMediaCleanupStatus.SUCCEEDED);
  assert.equal(await prisma.cv.findUnique({ where: { id: CV_PENDING } }), null);
  const recoveredCalls = applicationCalls.filter(
    (call) => call.body?.cvId === CV_PENDING,
  );
  assert.equal(recoveredCalls.length, 2);
  assert.equal(
    recoveredCalls.every(
      (call) => call.body.deletionRequestId === workflow.deletionRequestId,
    ),
    true,
  );

  const terminalRetry = await api(
    'DELETE',
    `/cvs/${CV_PENDING}`,
    token(USER_PENDING),
    { expectedAggregateVersion: response.body.data.aggregateVersion },
  );
  assert.equal(terminalRetry.status, 200);
  assert.equal(terminalRetry.body.data.deletionMode, 'HARD');
  assert.equal(terminalRetry.body.data.cleanupPending, false);
  assert.equal(
    applicationCalls.filter((call) => call.body?.cvId === CV_PENDING).length,
    2,
  );
});
