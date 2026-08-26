'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const {
  FileOwnerType,
  FileStatus,
  MediaType,
  PrismaClient,
} = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const {
  configureApplication,
} = require('../dist/main');
const {
  MEDIA_CLOCK,
} = require('../dist/media/media.service');
const {
  StorageProvider,
} = require('../dist/storage/storage-provider');
const { FakeStorageProvider } = require('./fake-storage-provider');
const {
  assertSafeTestDatabase,
} = require('./test-database-safety');

const CANDIDATE_A = '10000000-0000-4000-8000-000000000001';
const CANDIDATE_B = '10000000-0000-4000-8000-000000000002';
const RECRUITER = '10000000-0000-4000-8000-000000000003';
const ACTOR = '10000000-0000-4000-8000-000000000004';
const RATE_LIMIT_USER = '10000000-0000-4000-8000-000000000005';
const COMPANY = '20000000-0000-4000-8000-000000000001';
const COMPANY_B = '20000000-0000-4000-8000-000000000002';
const COMPANY_C = '20000000-0000-4000-8000-000000000003';
const INTERNAL_KEYS = {
  'profile-service': 'profile-0123456789abcdef0123456789abcdef',
  'company-service': 'company-0123456789abcdef0123456789abcdef',
  'application-service': 'application-0123456789abcdef0123456789abcdef',
  'chat-service': 'chat-0123456789abcdef0123456789abcdef',
  'interview-service': 'interview-0123456789abcdef0123456789abcdef',
  'ai-service': 'ai-0123456789abcdef0123456789abcdef',
};
const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const MIB = 1024 * 1024;
const CV_MAX_BYTES = 5 * MIB;
const AVATAR_MAX_BYTES = 2 * MIB;
const COMPANY_LOGO_MAX_BYTES = 2 * MIB;
const CHAT_ATTACHMENT_MAX_BYTES = 10 * MIB;

const keyPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privateKeyPem = keyPair.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const publicKeyPem = keyPair.publicKey.export({
  type: 'spki',
  format: 'pem',
});
const publicJwk = createPublicKey(publicKeyPem).export({
  format: 'jwk',
});
const kid = createHash('sha256')
  .update(
    JSON.stringify({
      e: publicJwk.e,
      kty: 'RSA',
      n: publicJwk.n,
    }),
  )
  .digest('base64url');

process.env.JWT_PUBLIC_KEY = String(publicKeyPem);
process.env.JWT_ISSUER = ISSUER;
process.env.JWT_AUDIENCE = AUDIENCE;
process.env.INTERNAL_API_KEY_PROFILE = INTERNAL_KEYS['profile-service'];
process.env.INTERNAL_API_KEY_COMPANY = INTERNAL_KEYS['company-service'];
process.env.INTERNAL_API_KEY_APPLICATION = INTERNAL_KEYS['application-service'];
process.env.INTERNAL_API_KEY_CHAT = INTERNAL_KEYS['chat-service'];
process.env.INTERNAL_API_KEY_INTERVIEW = INTERNAL_KEYS['interview-service'];
process.env.INTERNAL_API_KEY_AI = INTERNAL_KEYS['ai-service'];
process.env.SWAGGER_ENABLED = 'true';
process.env.CORS_ORIGINS = 'http://localhost:3000';

const jwt = new JwtService();

const accessToken = (
  subject,
  role,
  overrides = {},
) =>
  jwt.sign(
    {
      role,
      jti: randomUUID(),
      ...overrides.payload,
    },
    {
      privateKey: privateKeyPem,
      algorithm: 'RS256',
      issuer: overrides.issuer ?? ISSUER,
      audience: overrides.audience ?? AUDIENCE,
      subject,
      expiresIn: overrides.expiresIn ?? '15m',
      header: {
        alg: 'RS256',
        typ: overrides.typ ?? 'JWT',
        kid: overrides.kid ?? kid,
      },
    },
  );

test('File/Media signed upload API on PostgreSQL 16', async (t) => {
  const prisma = new PrismaClient();
  await prisma.$connect();
  await assertSafeTestDatabase(prisma);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "media"."file_reference", "media"."file_meta" RESTART IDENTITY CASCADE',
  );

  const fakeStorage = new FakeStorageProvider();
  let currentTime = new Date('2026-08-27T00:00:00.000Z');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(StorageProvider)
    .useValue(fakeStorage)
    .overrideProvider(MEDIA_CLOCK)
    .useValue(() => new Date(currentTime))
    .compile();
  const app = moduleRef.createNestApplication();
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const api = async (
    method,
    path,
    options = {},
  ) => {
    const headers = {
      accept: 'application/json',
      ...options.headers,
    };
    if (options.token) {
      headers.authorization = 'Bearer ' + options.token;
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
    });
    let payload = null;
    const text = await response.text();
    if (text) {
      payload = JSON.parse(text);
    }
    return { response, payload };
  };

  const internalHeaders = (
    service,
    key = INTERNAL_KEYS[service],
  ) => ({
    'x-internal-api-key': key,
    'x-internal-service': service,
  });

  const createPublicIntent = async (
    userId,
    role,
    type,
    originalFilename,
    idempotencyKey,
  ) =>
    api('POST', '/signature', {
      token: accessToken(userId, role),
      headers: idempotencyKey
        ? { 'idempotency-key': idempotencyKey }
        : {},
      body: { type, originalFilename },
    });

  const createInternalIntent = async (
    service,
    type,
    ownerType,
    ownerId,
    originalFilename,
    idempotencyKey,
    requestedBy = ACTOR,
  ) =>
    api('POST', '/internal/signature', {
      headers: {
        ...internalHeaders(service),
        ...(idempotencyKey
          ? { 'idempotency-key': idempotencyKey }
          : {}),
      },
      body: {
        type,
        ownerType,
        ownerId,
        requestedBy,
        originalFilename,
      },
    });

  await t.test('health is public and all business routes deny by default', async () => {
    const health = await api('GET', '/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.data.status, 'UP');
    assert.match(
      health.response.headers.get('cache-control'),
      /no-store/,
    );

    const denied = await api(
      'GET',
      '/' + randomUUID(),
    );
    assert.equal(denied.response.status, 401);

    const internalDenied = await api(
      'POST',
      '/internal/verify',
      {
        token: accessToken(CANDIDATE_A, 'CANDIDATE'),
        body: {
          fileId: randomUUID(),
          expectedOwnerType: 'USER',
          expectedOwnerId: CANDIDATE_A,
          expectedType: 'CV',
        },
      },
    );
    assert.equal(internalDenied.response.status, 401);

    const futureIat = await api(
      'GET',
      '/' + randomUUID(),
      {
        token: accessToken(CANDIDATE_A, 'CANDIDATE', {
          payload: {
            iat: Math.floor(Date.now() / 1000) + 3600,
          },
        }),
      },
    );
    assert.equal(futureIat.response.status, 401);

    const openApi = await api('GET', '/docs-json');
    assert.equal(openApi.response.status, 200);
    assert.equal(
      openApi.payload.info.title,
      'File/Media Service API',
    );
    assert.equal(
      Object.keys(openApi.payload.paths).some((path) =>
        path.startsWith('/internal'),
      ),
      false,
    );
  });

  let cvFileId;

  await t.test('signed intent is controlled, ten-minute and idempotent', async () => {
    const created = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'CV',
      'candidate.pdf',
      'intent-cv-0001',
    );
    assert.equal(created.response.status, 201);
    const capability = created.payload.data;
    cvFileId = capability.fileId;
    assert.equal(capability.params.folder, 'recruitment/cv');
    assert.equal(capability.params.type, 'authenticated');
    assert.equal(capability.params.overwrite, 'false');
    assert.equal(capability.maxBytes, 5 * 1024 * 1024);
    assert.equal(
      Math.floor(currentTime.getTime() / 1000) -
        capability.params.timestamp,
      3000,
    );
    assert.equal(
      new Date(capability.expiresAt).getTime() -
        currentTime.getTime(),
      10 * 60 * 1000,
    );
    assert.equal(
      JSON.stringify(created.payload).includes(
        'CLOUDINARY_API_SECRET',
      ),
      false,
    );

    const repeated = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'CV',
      'candidate.pdf',
      'intent-cv-0001',
    );
    assert.equal(repeated.response.status, 201);
    assert.equal(repeated.payload.data.fileId, cvFileId);
    assert.equal(
      repeated.payload.data.signature,
      capability.signature,
    );

    const crossType = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'AVATAR',
      'candidate.jpg',
      'intent-cv-0001',
    );
    assert.equal(crossType.response.status, 409);
    assert.equal(crossType.payload.code, 'FILE_IDEMPOTENCY_CONFLICT');

    const crossFilename = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'CV',
      'different.pdf',
      'intent-cv-0001',
    );
    assert.equal(crossFilename.response.status, 409);
    assert.equal(
      crossFilename.payload.code,
      'FILE_IDEMPOTENCY_CONFLICT',
    );

    const concurrentReplay = await Promise.all([
      createPublicIntent(
        CANDIDATE_B,
        'CANDIDATE',
        'CV',
        'race.pdf',
        'intent-race-0001',
      ),
      createPublicIntent(
        CANDIDATE_B,
        'CANDIDATE',
        'CV',
        'race.pdf',
        'intent-race-0001',
      ),
    ]);
    assert.deepEqual(
      concurrentReplay.map((result) => result.response.status),
      [201, 201],
    );
    assert.equal(
      concurrentReplay[0].payload.data.fileId,
      concurrentReplay[1].payload.data.fileId,
    );

    const crossProducer = await createInternalIntent(
      'profile-service',
      'CV',
      FileOwnerType.USER,
      CANDIDATE_B,
      'race.pdf',
      'intent-race-0001',
      CANDIDATE_B,
    );
    assert.equal(crossProducer.response.status, 409);
    assert.equal(
      crossProducer.payload.code,
      'FILE_IDEMPOTENCY_CONFLICT',
    );

    const ownerIntent = await createInternalIntent(
      'company-service',
      'COMPANY_IMAGE',
      FileOwnerType.COMPANY,
      COMPANY_B,
      'owner.jpg',
      'intent-owner-0001',
    );
    assert.equal(ownerIntent.response.status, 201);
    const crossOwner = await createInternalIntent(
      'company-service',
      'COMPANY_IMAGE',
      FileOwnerType.COMPANY,
      COMPANY,
      'owner.jpg',
      'intent-owner-0001',
    );
    assert.equal(crossOwner.response.status, 409);
    assert.equal(crossOwner.payload.code, 'FILE_IDEMPOTENCY_CONFLICT');
    const ownerCleanup = await api(
      'DELETE',
      '/internal/files/' + ownerIntent.payload.data.fileId,
      { headers: internalHeaders('company-service') },
    );
    assert.equal(ownerCleanup.response.status, 200);

    const unknownField = await api('POST', '/signature', {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      body: {
        type: 'CV',
        originalFilename: 'candidate.pdf',
        publicId: 'attacker-controlled',
      },
    });
    assert.equal(unknownField.response.status, 400);

    const row = await prisma.fileMeta.findUnique({
      where: { id: cvFileId },
    });
    assert.equal(row.status, FileStatus.PENDING);
    assert.match(row.publicId, /^recruitment\/cv\/[0-9a-f-]+\.pdf$/);
  });

  await t.test('role, purpose and filename policy is fail-closed', async () => {
    const recruiterCv = await createPublicIntent(
      RECRUITER,
      'RECRUITER',
      'CV',
      'resume.pdf',
    );
    assert.equal(recruiterCv.response.status, 403);

    const candidateCompany = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'COMPANY_IMAGE',
      'office.png',
    );
    assert.equal(candidateCompany.response.status, 403);

    const executable = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'CV',
      'payload.exe',
    );
    assert.equal(executable.response.status, 422);
  });

  await t.test('upload intent rate limit is atomic across all public purposes', async () => {
    const purposes = [
      ['CV', 'pdf'],
      ['AVATAR', 'jpg'],
      ['CHAT_ATTACHMENT', 'docx'],
    ];
    const attempts = await Promise.all(
      Array.from({ length: 60 }, (_, index) => {
        const [type, extension] = purposes[index % purposes.length];
        return createPublicIntent(
          RATE_LIMIT_USER,
          'CANDIDATE',
          type,
          'rate-' + index + '.' + extension,
        );
      }),
    );
    assert.equal(
      attempts.every((result) => result.response.status === 201),
      true,
    );
    assert.equal(
      await prisma.fileMeta.count({
        where: { requestedBy: RATE_LIMIT_USER },
      }),
      60,
    );

    const blocked = await createPublicIntent(
      RATE_LIMIT_USER,
      'CANDIDATE',
      'CV',
      'rate-blocked.pdf',
    );
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.payload.code, 'FILE_UPLOAD_RATE_LIMITED');
  });

  await t.test('confirm uses provider metadata and private delivery is owner-scoped', async () => {
    const row = await prisma.fileMeta.findUnique({
      where: { id: cvFileId },
    });
    fakeStorage.register(row, { bytes: CV_MAX_BYTES });

    const confirmed = await api('POST', '/', {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      body: { fileId: cvFileId },
    });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.payload.data.status, 'ACTIVE');
    assert.equal(confirmed.payload.data.mimeType, 'application/pdf');
    assert.equal(confirmed.payload.data.bytes, CV_MAX_BYTES);
    assert.equal(confirmed.payload.data.url, null);
    assert.equal(confirmed.payload.data.privateDelivery, true);

    const repeated = await api('POST', '/', {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      body: { fileId: cvFileId },
    });
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.payload.data.aggregateVersion, 3);

    const ownerRead = await api('GET', '/' + cvFileId, {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
    });
    assert.equal(ownerRead.response.status, 200);

    const idorRead = await api('GET', '/' + cvFileId, {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
    });
    assert.equal(idorRead.response.status, 404);

    const download = await api(
      'POST',
      '/' + cvFileId + '/download-url',
      { token: accessToken(CANDIDATE_A, 'CANDIDATE') },
    );
    assert.equal(download.response.status, 200);
    assert.match(download.payload.data.url, /^https:\/\/download\.test\//);
    assert.equal(
      new Date(download.payload.data.expiresAt).getTime() -
        currentTime.getTime(),
      5 * 60 * 1000,
    );

    const internalVerify = await api(
      'POST',
      '/internal/verify',
      {
        headers: internalHeaders('application-service'),
        body: {
          fileId: cvFileId,
          expectedOwnerType: 'USER',
          expectedOwnerId: CANDIDATE_A,
          expectedType: 'CV',
        },
      },
    );
    assert.equal(internalVerify.response.status, 200);
    assert.equal(internalVerify.payload.data.url, null);
  });

  await t.test('spoofed size and magic bytes are rejected and never activated', async () => {
    const oversizedIntent = await createPublicIntent(
      CANDIDATE_B,
      'CANDIDATE',
      'CV',
      'oversized.pdf',
    );
    const oversizedId = oversizedIntent.payload.data.fileId;
    const oversizedRow = await prisma.fileMeta.findUnique({
      where: { id: oversizedId },
    });
    fakeStorage.register(oversizedRow, {
      bytes: 5 * 1024 * 1024 + 1,
    });
    const oversized = await api('POST', '/', {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
      body: { fileId: oversizedId },
    });
    assert.equal(oversized.response.status, 422);
    assert.equal(oversized.payload.code, 'FILE_TOO_LARGE');
    assert.equal(
      (
        await prisma.fileMeta.findUnique({
          where: { id: oversizedId },
        })
      ).status,
      FileStatus.REJECTED,
    );

    const fakePdfIntent = await createPublicIntent(
      CANDIDATE_B,
      'CANDIDATE',
      'CV',
      'fake.pdf',
    );
    const fakePdfId = fakePdfIntent.payload.data.fileId;
    const fakePdfRow = await prisma.fileMeta.findUnique({
      where: { id: fakePdfId },
    });
    fakeStorage.register(fakePdfRow, {
      sample: Buffer.from('MZ executable'),
    });
    const fakePdf = await api('POST', '/', {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
      body: { fileId: fakePdfId },
    });
    assert.equal(fakePdf.response.status, 422);
    assert.equal(fakePdf.payload.code, 'FILE_CONTENT_MISMATCH');
  });

  await t.test('provider lookup outage is retryable and leaves intent pending', async () => {
    const intent = await createPublicIntent(
      CANDIDATE_B,
      'CANDIDATE',
      'CV',
      'retry.pdf',
    );
    const fileId = intent.payload.data.fileId;
    fakeStorage.failInspect = true;
    const failed = await api('POST', '/', {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
      body: { fileId },
    });
    fakeStorage.failInspect = false;
    assert.equal(failed.response.status, 503);
    const pending = await prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    assert.equal(pending.status, FileStatus.PENDING);

    const inspectCallsAfterFailure = fakeStorage.inspectCalls.length;
    const rateLimited = await api('POST', '/', {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
      body: { fileId },
    });
    assert.equal(rateLimited.response.status, 429);
    assert.equal(
      rateLimited.payload.code,
      'FILE_CONFIRM_RETRY_LATER',
    );
    assert.equal(
      fakeStorage.inspectCalls.length,
      inspectCallsAfterFailure,
    );

    currentTime = new Date(currentTime.getTime() + 6 * 1000);
    fakeStorage.register(pending, { bytes: CV_MAX_BYTES });
    const retried = await api('POST', '/', {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
      body: { fileId },
    });
    assert.equal(retried.response.status, 200);
    assert.equal(retried.payload.data.status, 'ACTIVE');
    assert.equal(retried.payload.data.bytes, CV_MAX_BYTES);
    assert.equal(
      fakeStorage.inspectCalls.length,
      inspectCallsAfterFailure + 1,
    );
  });

  let companyLogoId;

  await t.test('company media requires the scoped internal producer', async () => {
    const wrongKey = await api('POST', '/internal/signature', {
      headers: internalHeaders(
        'company-service',
        '1123456789abcdef0123456789abcdef',
      ),
      body: {
        type: 'COMPANY_LOGO',
        ownerType: 'COMPANY',
        ownerId: COMPANY,
        requestedBy: ACTOR,
        originalFilename: 'logo.png',
      },
    });
    assert.equal(wrongKey.response.status, 401);

    const intent = await createInternalIntent(
      'company-service',
      'COMPANY_LOGO',
      'COMPANY',
      COMPANY,
      'logo.png',
    );
    assert.equal(intent.response.status, 201);
    companyLogoId = intent.payload.data.fileId;
    const row = await prisma.fileMeta.findUnique({
      where: { id: companyLogoId },
    });
    fakeStorage.register(row, { bytes: COMPANY_LOGO_MAX_BYTES });

    const confirmed = await api(
      'POST',
      '/internal/confirm',
      {
        headers: internalHeaders('company-service'),
        body: { fileId: companyLogoId },
      },
    );
    assert.equal(confirmed.response.status, 200);
    assert.equal(
      confirmed.payload.data.bytes,
      COMPANY_LOGO_MAX_BYTES,
    );
    assert.match(
      confirmed.payload.data.url,
      /^https:\/\/res\.cloudinary\.com\//,
    );

    const secondLogo = await createInternalIntent(
      'company-service',
      'COMPANY_LOGO',
      'COMPANY',
      COMPANY,
      'second.png',
    );
    assert.equal(secondLogo.response.status, 409);
    assert.equal(secondLogo.payload.code, 'FILE_LIMIT_REACHED');

    const crossService = await api(
      'POST',
      '/internal/verify',
      {
        headers: internalHeaders('profile-service'),
        body: {
          fileId: companyLogoId,
          expectedOwnerType: 'COMPANY',
          expectedOwnerId: COMPANY,
          expectedType: 'COMPANY_LOGO',
        },
      },
    );
    assert.equal(crossService.response.status, 403);
  });

  await t.test('reference binding is idempotent and blocks deletion until release', async () => {
    const expectation = {
      fileId: cvFileId,
      expectedOwnerType: 'USER',
      expectedOwnerId: CANDIDATE_A,
      expectedType: 'CV',
      referenceType: 'CV',
      referenceId: 'application-0001',
    };
    const concurrentBinds = await Promise.all(
      Array.from({ length: 5 }, () =>
        api('POST', '/internal/references', {
          headers: internalHeaders('profile-service'),
          body: expectation,
        }),
      ),
    );
    assert.equal(
      concurrentBinds.every(
        (result) => result.response.status === 201,
      ),
      true,
    );
    assert.equal(
      new Set(
        concurrentBinds.map((result) => result.payload.data.id),
      ).size,
      1,
    );
    assert.equal(
      await prisma.fileReference.count({
        where: {
          fileId: cvFileId,
          callerService: 'profile-service',
          referenceType: 'CV',
          referenceId: 'application-0001',
        },
      }),
      1,
    );
    const first = concurrentBinds[0];

    const blocked = await api('DELETE', '/' + cvFileId, {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
    });
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.payload.code, 'FILE_IN_USE');

    await api(
      'DELETE',
      '/internal/references/' + first.payload.data.id,
      { headers: internalHeaders('application-service') },
    );
    const stillBlocked = await api('DELETE', '/' + cvFileId, {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
    });
    assert.equal(stillBlocked.response.status, 409);

    const released = await api(
      'DELETE',
      '/internal/references/' + first.payload.data.id,
      { headers: internalHeaders('profile-service') },
    );
    assert.equal(released.response.status, 200);

    const deleted = await api('DELETE', '/' + cvFileId, {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.payload.data.status, 'DELETED');

    const repeatedDelete = await api(
      'DELETE',
      '/' + cvFileId,
      { token: accessToken(CANDIDATE_A, 'CANDIDATE') },
    );
    assert.equal(repeatedDelete.response.status, 200);
    assert.equal(repeatedDelete.payload.data.status, 'DELETED');
  });

  await t.test('storage delete failure is visible and retryable', async () => {
    const intent = await createPublicIntent(
      CANDIDATE_B,
      'CANDIDATE',
      'AVATAR',
      'avatar.png',
    );
    const fileId = intent.payload.data.fileId;
    const row = await prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    fakeStorage.register(row, { bytes: AVATAR_MAX_BYTES });
    const confirmed = await api('POST', '/', {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
      body: { fileId },
    });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.payload.data.bytes, AVATAR_MAX_BYTES);

    fakeStorage.failDelete = true;
    const failed = await api('DELETE', '/' + fileId, {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
    });
    fakeStorage.failDelete = false;
    assert.equal(failed.response.status, 503);
    assert.equal(
      (
        await prisma.fileMeta.findUnique({
          where: { id: fileId },
        })
      ).status,
      FileStatus.DELETE_FAILED,
    );

    const retried = await api('DELETE', '/' + fileId, {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
    });
    assert.equal(retried.response.status, 200);
    assert.equal(retried.payload.data.status, 'DELETED');
  });

  await t.test('stale confirmation and deletion leases are recoverable', async () => {
    const intent = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'AVATAR',
      'recoverable.png',
    );
    assert.equal(intent.response.status, 201);
    const fileId = intent.payload.data.fileId;
    const pending = await prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    fakeStorage.register(pending);

    const verifying = await prisma.fileMeta.update({
      where: { id: fileId },
      data: {
        status: FileStatus.VERIFYING,
        aggregateVersion: { increment: 1 },
      },
    });
    currentTime = new Date(
      verifying.updatedAt.getTime() + 60 * 1000,
    );
    const freshConfirmation = await api('POST', '/', {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      body: { fileId },
    });
    assert.equal(freshConfirmation.response.status, 409);
    assert.equal(
      freshConfirmation.payload.code,
      'FILE_CONFIRMATION_IN_PROGRESS',
    );

    currentTime = new Date(
      Math.max(
        pending.createdAt.getTime(),
        verifying.updatedAt.getTime(),
      ) +
        6 * 60 * 1000,
    );
    const recoveredConfirmation = await api('POST', '/', {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      body: { fileId },
    });
    assert.equal(recoveredConfirmation.response.status, 200);
    assert.equal(recoveredConfirmation.payload.data.status, 'ACTIVE');
    const confirmationClock = new Date(currentTime);

    const deletePending = await prisma.fileMeta.update({
      where: { id: fileId },
      data: {
        status: FileStatus.DELETE_PENDING,
        aggregateVersion: { increment: 1 },
      },
    });
    currentTime = new Date(
      deletePending.updatedAt.getTime() + 60 * 1000,
    );
    const freshDeletion = await api('DELETE', '/' + fileId, {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
    });
    assert.equal(freshDeletion.response.status, 409);
    assert.equal(freshDeletion.payload.code, 'FILE_DELETE_IN_PROGRESS');

    currentTime = new Date(
      Math.max(
        confirmationClock.getTime(),
        deletePending.updatedAt.getTime(),
      ) +
        6 * 60 * 1000,
    );
    const recoveredDeletion = await api('DELETE', '/' + fileId, {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
    });
    assert.equal(recoveredDeletion.response.status, 200);
    assert.equal(recoveredDeletion.payload.data.status, 'DELETED');
  });

  await t.test('stale workers are fenced after confirm and delete lease takeover', async () => {
    const intent = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'AVATAR',
      'fenced-worker.png',
    );
    assert.equal(intent.response.status, 201);
    const fileId = intent.payload.data.fileId;
    const pending = await prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    const winningAsset = fakeStorage.register(pending, {
      bytes: AVATAR_MAX_BYTES,
      etag: 'etag-confirm-winner-' + fileId,
    });

    let enterOldInspect;
    const oldInspectEntered = new Promise((resolve) => {
      enterOldInspect = resolve;
    });
    let releaseOldInspect;
    const oldInspectReleased = new Promise((resolve) => {
      releaseOldInspect = resolve;
    });
    let targetInspectCalls = 0;
    fakeStorage.inspectHook = async (locator) => {
      if (locator.publicId !== pending.publicId) {
        return;
      }
      targetInspectCalls += 1;
      if (targetInspectCalls === 1) {
        enterOldInspect();
        await oldInspectReleased;
      }
    };

    const oldConfirmPromise = api('POST', '/', {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      body: { fileId },
    });
    let winningConfirmation;
    try {
      await oldInspectEntered;
      const oldClaim = await prisma.fileMeta.findUnique({
        where: { id: fileId },
      });
      assert.equal(oldClaim.status, FileStatus.VERIFYING);
      currentTime = new Date(
        oldClaim.updatedAt.getTime() + 6 * 60 * 1000,
      );
      winningConfirmation = await api('POST', '/', {
        token: accessToken(CANDIDATE_A, 'CANDIDATE'),
        body: { fileId },
      });
      assert.equal(winningConfirmation.response.status, 200);
      assert.equal(
        winningConfirmation.payload.data.status,
        'ACTIVE',
      );
      assert.equal(
        winningConfirmation.payload.data.bytes,
        AVATAR_MAX_BYTES,
      );
      fakeStorage.register(pending, {
        bytes: AVATAR_MAX_BYTES - 1,
        etag: 'etag-confirm-stale-' + fileId,
      });
    } finally {
      fakeStorage.inspectHook = null;
      releaseOldInspect();
    }

    const oldConfirmation = await oldConfirmPromise;
    assert.equal(oldConfirmation.response.status, 200);
    assert.equal(oldConfirmation.payload.data.status, 'ACTIVE');
    assert.equal(
      oldConfirmation.payload.data.bytes,
      AVATAR_MAX_BYTES,
    );
    assert.equal(targetInspectCalls, 2);
    const confirmed = await prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    assert.equal(confirmed.status, FileStatus.ACTIVE);
    assert.equal(confirmed.bytes, AVATAR_MAX_BYTES);
    assert.equal(confirmed.etag, winningAsset.etag);
    assert.equal(
      confirmed.aggregateVersion,
      winningConfirmation.payload.data.aggregateVersion,
    );

    let enterOldDelete;
    const oldDeleteEntered = new Promise((resolve) => {
      enterOldDelete = resolve;
    });
    let releaseOldDelete;
    const oldDeleteReleased = new Promise((resolve) => {
      releaseOldDelete = resolve;
    });
    let targetDeleteCalls = 0;
    fakeStorage.deleteHook = async (locator) => {
      if (locator.publicId !== pending.publicId) {
        return;
      }
      targetDeleteCalls += 1;
      if (targetDeleteCalls === 1) {
        enterOldDelete();
        await oldDeleteReleased;
      }
    };

    const oldDeletePromise = api('DELETE', '/' + fileId, {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
    });
    let winningDeletion;
    let winningDeletedRow;
    try {
      await oldDeleteEntered;
      const oldClaim = await prisma.fileMeta.findUnique({
        where: { id: fileId },
      });
      assert.equal(oldClaim.status, FileStatus.DELETE_PENDING);
      currentTime = new Date(
        oldClaim.updatedAt.getTime() + 6 * 60 * 1000,
      );
      winningDeletion = await api('DELETE', '/' + fileId, {
        token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      });
      assert.equal(winningDeletion.response.status, 200);
      assert.equal(winningDeletion.payload.data.status, 'DELETED');
      winningDeletedRow = await prisma.fileMeta.findUnique({
        where: { id: fileId },
      });
      currentTime = new Date(currentTime.getTime() + 60 * 1000);
    } finally {
      fakeStorage.deleteHook = null;
      releaseOldDelete();
    }

    const oldDeletion = await oldDeletePromise;
    assert.equal(oldDeletion.response.status, 200);
    assert.equal(oldDeletion.payload.data.status, 'DELETED');
    assert.equal(targetDeleteCalls, 2);
    const deleted = await prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    assert.equal(deleted.status, FileStatus.DELETED);
    assert.equal(
      deleted.aggregateVersion,
      winningDeletedRow.aggregateVersion,
    );
    assert.equal(
      deleted.deletedAt.getTime(),
      winningDeletedRow.deletedAt.getTime(),
    );
    assert.equal(
      oldDeletion.payload.data.aggregateVersion,
      winningDeletion.payload.data.aggregateVersion,
    );
  });

  await t.test('expired upload intent cannot be activated', async () => {
    const intent = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'CV',
      'expired.pdf',
    );
    const fileId = intent.payload.data.fileId;
    const row = await prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    fakeStorage.register(row);
    currentTime = new Date(
      currentTime.getTime() + 11 * 60 * 1000,
    );

    const expired = await api('POST', '/', {
      token: accessToken(CANDIDATE_A, 'CANDIDATE'),
      body: { fileId },
    });
    assert.equal(expired.response.status, 410);
    assert.equal(expired.payload.code, 'FILE_INTENT_EXPIRED');
    assert.equal(
      (
        await prisma.fileMeta.findUnique({
          where: { id: fileId },
        })
      ).status,
      FileStatus.EXPIRED,
    );
  });

  await t.test('all six v1 purposes activate at their exact size boundary', async () => {
    const activateCompany = async (
      type,
      filename,
      bytes,
      overrides = {},
    ) => {
      const intent = await createInternalIntent(
        'company-service',
        type,
        FileOwnerType.COMPANY,
        COMPANY_B,
        filename,
      );
      assert.equal(intent.response.status, 201);
      const row = await prisma.fileMeta.findUnique({
        where: { id: intent.payload.data.fileId },
      });
      fakeStorage.register(row, { bytes, ...overrides });
      const confirmed = await api(
        'POST',
        '/internal/confirm',
        {
          headers: internalHeaders('company-service'),
          body: { fileId: row.id },
        },
      );
      assert.equal(confirmed.response.status, 200);
      assert.equal(confirmed.payload.data.status, 'ACTIVE');
      assert.equal(confirmed.payload.data.bytes, bytes);
      return confirmed.payload.data;
    };

    const image = await activateCompany(
      'COMPANY_IMAGE',
      'office.webp',
      5 * 1024 * 1024,
    );
    assert.equal(image.type, 'COMPANY_IMAGE');

    const video = await activateCompany(
      'COMPANY_VIDEO',
      'tour.mp4',
      50 * 1024 * 1024,
      { durationSeconds: 300 },
    );
    assert.equal(video.type, 'COMPANY_VIDEO');

    const chatIntent = await createPublicIntent(
      CANDIDATE_B,
      'CANDIDATE',
      'CHAT_ATTACHMENT',
      'message.docx',
    );
    assert.equal(chatIntent.response.status, 201);
    const chatRow = await prisma.fileMeta.findUnique({
      where: { id: chatIntent.payload.data.fileId },
    });
    fakeStorage.register(chatRow, {
      bytes: CHAT_ATTACHMENT_MAX_BYTES,
    });
    const chatConfirmed = await api('POST', '/', {
      token: accessToken(CANDIDATE_B, 'CANDIDATE'),
      body: { fileId: chatRow.id },
    });
    assert.equal(chatConfirmed.response.status, 200);
    assert.equal(chatConfirmed.payload.data.type, 'CHAT_ATTACHMENT');
    assert.equal(
      chatConfirmed.payload.data.bytes,
      CHAT_ATTACHMENT_MAX_BYTES,
    );
    assert.equal(chatConfirmed.payload.data.privateDelivery, true);
    assert.equal(chatConfirmed.payload.data.url, null);

    const chatDownload = await api(
      'POST',
      '/' + chatRow.id + '/download-url',
      { token: accessToken(CANDIDATE_B, 'CANDIDATE') },
    );
    assert.equal(chatDownload.response.status, 200);
    assert.match(
      chatDownload.payload.data.url,
      /^https:\/\/download\.test\//,
    );

    const confirmedPurposes = await prisma.fileMeta.groupBy({
      by: ['mediaType'],
      where: { confirmedAt: { not: null } },
    });
    assert.deepEqual(
      new Set(confirmedPurposes.map((entry) => entry.mediaType)),
      new Set([
        MediaType.CV,
        MediaType.AVATAR,
        MediaType.COMPANY_LOGO,
        MediaType.COMPANY_IMAGE,
        MediaType.COMPANY_VIDEO,
        MediaType.CHAT_ATTACHMENT,
      ]),
    );
  });

  await t.test('quota is rechecked when confirm crosses the intent TTL', async () => {
    const firstIntent = await createInternalIntent(
      'company-service',
      'COMPANY_LOGO',
      FileOwnerType.COMPANY,
      COMPANY_C,
      'slow-logo.png',
    );
    assert.equal(firstIntent.response.status, 201);
    const firstRow = await prisma.fileMeta.findUnique({
      where: { id: firstIntent.payload.data.fileId },
    });
    fakeStorage.register(firstRow, {
      bytes: COMPANY_LOGO_MAX_BYTES,
    });

    let enterInspection;
    const inspectionEntered = new Promise((resolve) => {
      enterInspection = resolve;
    });
    let releaseInspection;
    const inspectionReleased = new Promise((resolve) => {
      releaseInspection = resolve;
    });
    fakeStorage.inspectHook = async (locator) => {
      if (locator.publicId === firstRow.publicId) {
        enterInspection();
        await inspectionReleased;
      }
    };

    const firstConfirmationPromise = api(
      'POST',
      '/internal/confirm',
      {
        headers: internalHeaders('company-service'),
        body: { fileId: firstRow.id },
      },
    );
    let replacement;
    try {
      await inspectionEntered;
      currentTime = new Date(
        firstRow.intentExpiresAt.getTime() + 1000,
      );
      replacement = await createInternalIntent(
        'company-service',
        'COMPANY_LOGO',
        FileOwnerType.COMPANY,
        COMPANY_C,
        'replacement-logo.png',
      );
      assert.equal(replacement.response.status, 201);
    } finally {
      fakeStorage.inspectHook = null;
      releaseInspection();
    }

    const firstConfirmation = await firstConfirmationPromise;
    assert.equal(firstConfirmation.response.status, 200);
    assert.equal(firstConfirmation.payload.data.status, 'ACTIVE');

    const replacementRow = await prisma.fileMeta.findUnique({
      where: { id: replacement.payload.data.fileId },
    });
    fakeStorage.register(replacementRow, {
      bytes: COMPANY_LOGO_MAX_BYTES,
    });
    const replacementConfirmation = await api(
      'POST',
      '/internal/confirm',
      {
        headers: internalHeaders('company-service'),
        body: { fileId: replacementRow.id },
      },
    );
    assert.equal(replacementConfirmation.response.status, 409);
    assert.equal(
      replacementConfirmation.payload.code,
      'FILE_LIMIT_REACHED',
    );
    assert.equal(
      await prisma.fileMeta.count({
        where: {
          ownerId: COMPANY_C,
          mediaType: MediaType.COMPANY_LOGO,
          status: FileStatus.ACTIVE,
        },
      }),
      1,
    );
  });

  await t.test('company image quota remains correct under concurrent intents', async () => {
    const requests = Array.from({ length: 11 }, (_, index) =>
      createInternalIntent(
        'company-service',
        'COMPANY_IMAGE',
        FileOwnerType.COMPANY,
        COMPANY,
        'office-' + index + '.jpg',
      ),
    );
    const results = await Promise.all(requests);
    assert.equal(
      results.filter((result) => result.response.status === 201)
        .length,
      10,
    );
    assert.equal(
      results.filter((result) => result.response.status === 409)
        .length,
      1,
    );
  });

  await t.test('database constraints protect active metadata and audit history', async () => {
    const constraintIntent = await createPublicIntent(
      CANDIDATE_A,
      'CANDIDATE',
      'AVATAR',
      'constraint.png',
    );
    assert.equal(constraintIntent.response.status, 201);
    const constraintId = constraintIntent.payload.data.fileId;
    await prisma.fileMeta.update({
      where: { id: constraintId },
      data: {
        status: FileStatus.VERIFYING,
        aggregateVersion: { increment: 1 },
      },
    });
    await assert.rejects(() =>
      prisma.fileMeta.update({
        where: { id: constraintId },
        data: {
          status: FileStatus.ACTIVE,
          assetId: 'constraint-' + constraintId,
          providerVersion: '1',
          canonicalUrl:
            'https://res.cloudinary.com/test-cloud/image/upload/v1/' +
            constraintId,
          mimeType: 'image/png',
          format: 'png',
          bytes: 2 * 1024 * 1024 + 1,
          width: 800,
          height: 600,
          confirmedAt: new Date(currentTime),
          aggregateVersion: { increment: 1 },
        },
      }),
    );

    const logo = await prisma.fileMeta.findUnique({
      where: { id: companyLogoId },
    });
    await assert.rejects(() =>
      prisma.fileMeta.update({
        where: { id: companyLogoId },
        data: {
          bytes: logo.bytes + 1,
          aggregateVersion: { increment: 1 },
        },
      }),
    );
    await assert.rejects(() =>
      prisma.fileMeta.update({
        where: { id: companyLogoId },
        data: {
          etag: logo.etag + '-tampered',
          aggregateVersion: { increment: 1 },
        },
      }),
    );
    await assert.rejects(() =>
      prisma.fileMeta.update({
        where: { id: companyLogoId },
        data: {
          createdAt: new Date(logo.createdAt.getTime() - 1000),
          aggregateVersion: { increment: 1 },
        },
      }),
    );
    await assert.rejects(() =>
      prisma.fileMeta.update({
        where: { id: companyLogoId },
        data: { aggregateVersion: logo.aggregateVersion },
      }),
    );

    const deletedCv = await prisma.fileMeta.findUnique({
      where: { id: cvFileId },
    });
    await assert.rejects(() =>
      prisma.fileMeta.update({
        where: { id: cvFileId },
        data: {
          deletedAt: new Date(deletedCv.deletedAt.getTime() + 1000),
          aggregateVersion: { increment: 1 },
        },
      }),
    );
    await assert.rejects(() =>
      prisma.fileMeta.delete({
        where: { id: companyLogoId },
      }),
    );

    const pending = await prisma.fileMeta.findFirst({
      where: { status: FileStatus.PENDING },
    });
    await assert.rejects(() =>
      prisma.fileReference.create({
        data: {
          fileId: pending.id,
          callerService: 'profile-service',
          referenceType: 'CV',
          referenceId: 'pending-reference',
        },
      }),
    );
  });
});
