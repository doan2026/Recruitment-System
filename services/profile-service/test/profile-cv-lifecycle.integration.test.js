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
const APPLICATION_OUTBOUND_KEY =
  'profile-to-application-lifecycle-key-000000000001';
const APPLICATION_INBOUND_KEY =
  'application-to-profile-lifecycle-key-000000000001';
const MEDIA_KEY = 'profile-lifecycle-media-key-0000000000000001';

const CANDIDATE_A = '11000000-0000-4000-8000-000000000001';
const CANDIDATE_B = '11000000-0000-4000-8000-000000000002';
const CANDIDATE_C = '11000000-0000-4000-8000-000000000003';
const CANDIDATE_D = '11000000-0000-4000-8000-000000000004';
const CANDIDATE_E = '11000000-0000-4000-8000-000000000005';
const OTHER_CANDIDATE = '11000000-0000-4000-8000-000000000099';

const CV_A1 = '21000000-0000-4000-8000-000000000001';
const CV_A2 = '21000000-0000-4000-8000-000000000002';
const CV_A3 = '21000000-0000-4000-8000-000000000003';
const CV_B1 = '22000000-0000-4000-8000-000000000001';
const CV_B2 = '22000000-0000-4000-8000-000000000002';
const CV_B3 = '22000000-0000-4000-8000-000000000003';
const CV_B4 = '22000000-0000-4000-8000-000000000004';
const CV_C1 = '23000000-0000-4000-8000-000000000001';
const CV_C2 = '23000000-0000-4000-8000-000000000002';
const CV_D1 = '24000000-0000-4000-8000-000000000001';
const CV_D2 = '24000000-0000-4000-8000-000000000002';
const CV_D3 = '24000000-0000-4000-8000-000000000003';
const CV_E1 = '25000000-0000-4000-8000-000000000001';
const CV_E2 = '25000000-0000-4000-8000-000000000002';

const USED_AT_B1 = '2026-08-27T10:00:00.000Z';

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
process.env.MEDIA_SERVICE_URL = 'http://127.0.0.1:9';
process.env.MEDIA_INTERNAL_API_KEY = MEDIA_KEY;
process.env.MEDIA_REQUEST_TIMEOUT_MS = '500';
process.env.SWAGGER_ENABLED = 'true';

const prisma = new PrismaClient();
const jwt = new JwtService();
const usageRequests = [];
const usageStates = new Map();
let usageServer;
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

const validUsage = (candidateId, cvId, overrides = {}) => ({
  candidateId,
  cvId,
  used: false,
  firstUsedAt: null,
  applicationCount: 0,
  ...overrides,
});

const handleUsageRequest = async (request, response) => {
  const body = await readBody(request);
  usageRequests.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body,
  });

  if (
    request.headers['x-internal-api-key'] !== APPLICATION_OUTBOUND_KEY ||
    request.headers['x-internal-service'] !== 'profile-service'
  ) {
    return json(response, 401, { code: 'UNAUTHORIZED' });
  }
  if (
    request.method !== 'POST' ||
    request.url !== '/internal/v1/cv-usages/lookup'
  ) {
    return json(response, 404, { code: 'NOT_FOUND' });
  }

  const state = usageStates.get(body?.cvId);
  if (state?.status) {
    return json(response, state.status, { code: 'UPSTREAM_FAILURE' });
  }
  if (state?.payload) {
    return json(response, 200, state.payload);
  }
  return json(response, 200, {
    data:
      state?.usage ?? validUsage(body.candidateId, body.cvId),
    meta: null,
  });
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
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
};

const expectSuccess = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.meta, null);
  return response.body.data;
};

const cvFixture = (
  id,
  title,
  isDefault,
  createdAt,
  overrides = {},
) => ({
  id,
  title,
  type: CvType.UPLOAD,
  fileId: randomUUID(),
  fileUrl: null,
  mediaReferenceId: randomUUID(),
  isDefault,
  createdAt: new Date(createdAt),
  ...overrides,
});

const createProfile = (userId, cvs) =>
  prisma.profile.create({
    data: {
      userId,
      cvs: { create: cvs },
    },
  });

const databaseErrorText = (error) =>
  `${String(error?.message ?? error)} ${JSON.stringify(error?.meta ?? {})}`;

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."profiles" CASCADE',
  );

  usageServer = createServer((request, response) => {
    handleUsageRequest(request, response).catch((error) =>
      json(response, 500, {
        code: 'FAKE_APPLICATION_ERROR',
        message: error.message,
      }),
    );
  });
  await new Promise((resolve) =>
    usageServer.listen(0, '127.0.0.1', resolve),
  );
  process.env.APPLICATION_SERVICE_URL =
    `http://127.0.0.1:${usageServer.address().port}`;

  await createProfile(CANDIDATE_A, [
    cvFixture(CV_A1, 'Default CV', true, '2026-08-27T01:00:00.000Z'),
    cvFixture(
      CV_A2,
      'Used CV',
      false,
      '2026-08-27T02:00:00.000Z',
      {
        type: CvType.ONLINE,
        templateId: 'clean-v1',
        contentSchemaVersion: 1,
        contentJson: { basics: { fullName: 'Lifecycle Candidate A' } },
        firstUsedAt: new Date('2026-08-27T03:00:00.000Z'),
      },
    ),
    cvFixture(CV_A3, 'Third CV', false, '2026-08-27T04:00:00.000Z'),
  ]);
  await createProfile(CANDIDATE_B, [
    cvFixture(CV_B1, 'Submitted default', true, '2026-08-27T01:00:00.000Z'),
    cvFixture(CV_B2, 'Newest tie A', false, '2026-08-27T08:00:00.000Z'),
    cvFixture(CV_B3, 'Newest tie B', false, '2026-08-27T08:00:00.000Z'),
    cvFixture(CV_B4, 'Older candidate', false, '2026-08-27T07:00:00.000Z'),
  ]);
  await createProfile(CANDIDATE_C, [
    cvFixture(CV_C1, 'Only eventual CV', true, '2026-08-27T01:00:00.000Z'),
    cvFixture(
      CV_C2,
      'Non-default Online CV',
      false,
      '2026-08-27T02:00:00.000Z',
      {
        type: CvType.ONLINE,
        templateId: 'clean-v1',
        contentSchemaVersion: 1,
        contentJson: { basics: { fullName: 'Lifecycle Candidate C' } },
      },
    ),
  ]);
  await createProfile(CANDIDATE_D, [
    cvFixture(CV_D1, 'Usage outage', true, '2026-08-27T01:00:00.000Z'),
    cvFixture(CV_D2, 'Usage invalid', false, '2026-08-27T02:00:00.000Z'),
    cvFixture(CV_D3, 'Stale or IDOR', false, '2026-08-27T03:00:00.000Z'),
  ]);
  await createProfile(CANDIDATE_E, [
    cvFixture(CV_E1, 'Invariant default', true, '2026-08-27T01:00:00.000Z'),
    cvFixture(CV_E2, 'Invariant secondary', false, '2026-08-27T02:00:00.000Z'),
  ]);

  usageStates.set(CV_B1, {
    usage: validUsage(CANDIDATE_B, CV_B1, {
      used: true,
      firstUsedAt: USED_AT_B1,
      applicationCount: 3,
    }),
  });
  usageStates.set(CV_C1, {
    usage: validUsage(CANDIDATE_C, CV_C1),
  });
  usageStates.set(CV_C2, {
    usage: validUsage(CANDIDATE_C, CV_C2),
  });
  usageStates.set(CV_D1, { status: 503 });
  usageStates.set(CV_D2, {
    payload: {
      data: validUsage(CANDIDATE_D, CV_D2, {
        applicationCount: 1,
      }),
      meta: null,
    },
  });
  usageStates.set(CV_D3, {
    usage: validUsage(CANDIDATE_D, CV_D3, {
      used: true,
      firstUsedAt: '2026-08-27T00:00:00.000Z',
      applicationCount: 1,
    }),
  });

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
        'TRUNCATE TABLE "profile"."profiles" CASCADE',
      );
    }
    if (app) await app.close();
    if (usageServer) {
      await new Promise((resolve, reject) =>
        usageServer.close((error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('Profile CV lifecycle integration', async (t) => {
  const tokenA = accessToken(CANDIDATE_A);
  const tokenB = accessToken(CANDIDATE_B);
  const tokenC = accessToken(CANDIDATE_C);
  const tokenD = accessToken(CANDIDATE_D);
  const otherToken = accessToken(OTHER_CANDIDATE);

  await t.test('rename trims, uses CAS, is idempotent, and permits title changes after use', async () => {
    const callsBefore = usageRequests.length;
    const profileVersionBefore = (
      await prisma.profile.findUniqueOrThrow({
        where: { userId: CANDIDATE_A },
      })
    ).aggregateVersion;
    const renameResponse = await api(
      'PATCH',
      `/cvs/${CV_A2}`,
      tokenA,
      {
        title: '  Renamed used CV  ',
        expectedAggregateVersion: 1,
      },
    );
    const renamed = expectSuccess(renameResponse);
    assert.equal(renamed.title, 'Renamed used CV');
    assert.equal(renamed.type, 'ONLINE');
    assert.equal(renamed.aggregateVersion, 2);
    assert.match(
      renameResponse.headers.get('cache-control') ?? '',
      /(?:^|,)\s*private\b.*\bno-store\b/i,
    );
    assert.equal(usageRequests.length, callsBefore);

    const persisted = await prisma.cv.findUniqueOrThrow({
      where: { id: CV_A2 },
    });
    assert.equal(persisted.title, 'Renamed used CV');
    assert.equal(
      persisted.firstUsedAt.toISOString(),
      '2026-08-27T03:00:00.000Z',
    );

    const stale = await api('PATCH', `/cv/${CV_A2}`, tokenA, {
      title: 'Must not win',
      expectedAggregateVersion: 1,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'CV_VERSION_CONFLICT');

    const retry = expectSuccess(
      await api('PATCH', `/cv/${CV_A2}`, tokenA, {
        title: 'Renamed used CV',
        expectedAggregateVersion: 1,
      }),
    );
    assert.equal(retry.aggregateVersion, 2);

    const idor = await api('PATCH', `/cvs/${CV_A2}`, otherToken, {
      title: 'Attacker title',
      expectedAggregateVersion: 2,
    });
    assert.equal(idor.status, 404);
    assert.equal(idor.body.code, 'CV_NOT_FOUND');
    assert.equal(usageRequests.length, callsBefore);
    assert.equal(
      (await prisma.cv.findUniqueOrThrow({ where: { id: CV_A2 } })).title,
      'Renamed used CV',
    );
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_A },
        })
      ).aggregateVersion,
      profileVersionBefore + 1,
      'stale, idempotent, and IDOR rename attempts must not bump Profile',
    );
  });

  await t.test('default switches are atomic, idempotent, and converge under concurrency', async () => {
    const profileVersionBefore = (
      await prisma.profile.findUniqueOrThrow({
        where: { userId: CANDIDATE_A },
      })
    ).aggregateVersion;
    const selected = expectSuccess(
      await api('PATCH', `/cvs/${CV_A3}/default`, tokenA, {
        expectedAggregateVersion: 1,
      }),
    );
    assert.equal(selected.id, CV_A3);
    assert.equal(selected.isDefault, true);
    assert.equal(selected.aggregateVersion, 2);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_A },
        })
      ).aggregateVersion,
      profileVersionBefore + 1,
    );

    const retry = expectSuccess(
      await api('PATCH', `/cv/${CV_A3}/default`, tokenA, {
        expectedAggregateVersion: 1,
      }),
    );
    assert.equal(retry.aggregateVersion, 2);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_A },
        })
      ).aggregateVersion,
      profileVersionBefore + 1,
      'idempotent default retry must not bump Profile',
    );

    let active = await prisma.cv.findMany({
      where: { userId: CANDIDATE_A, isDeleted: false },
    });
    assert.equal(active.filter((cv) => cv.isDefault).length, 1);
    assert.equal(active.find((cv) => cv.isDefault).id, CV_A3);

    const switches = await Promise.all([
      api('PATCH', `/cvs/${CV_A1}/default`, tokenA, {
        expectedAggregateVersion: 2,
      }),
      api('PATCH', `/cv/${CV_A2}/default`, tokenA, {
        expectedAggregateVersion: 2,
      }),
    ]);
    assert.equal(
      switches.every((response) => response.status === 200),
      true,
      JSON.stringify(switches.map((response) => response.body)),
    );

    active = await prisma.cv.findMany({
      where: { userId: CANDIDATE_A, isDeleted: false },
    });
    const defaults = active.filter((cv) => cv.isDefault);
    assert.equal(defaults.length, 1);
    const finalDefault = defaults[0];
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_A },
        })
      ).aggregateVersion,
      profileVersionBefore + 3,
      'each of the two concurrent logical switches must bump Profile once',
    );
    const repeated = expectSuccess(
      await api('PATCH', `/cvs/${finalDefault.id}/default`, tokenA, {
        expectedAggregateVersion: 1,
      }),
    );
    assert.equal(repeated.id, finalDefault.id);
    assert.equal(repeated.aggregateVersion, finalDefault.aggregateVersion);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_A },
        })
      ).aggregateVersion,
      profileVersionBefore + 3,
    );
  });

  await t.test('default soft-delete mirrors authoritative usage and reassigns deterministically', async () => {
    const mediaReferenceBefore = (
      await prisma.cv.findUniqueOrThrow({ where: { id: CV_B1 } })
    ).mediaReferenceId;
    const callsBefore = usageRequests.length;
    const deleted = expectSuccess(
      await api('DELETE', `/cvs/${CV_B1}`, tokenB, {
        expectedAggregateVersion: 1,
      }),
    );
    assert.deepEqual(
      {
        id: deleted.id,
        userId: deleted.userId,
        deletionMode: deleted.deletionMode,
        isDeleted: deleted.isDeleted,
        replacementDefaultCvId: deleted.replacementDefaultCvId,
        aggregateVersion: deleted.aggregateVersion,
      },
      {
        id: CV_B1,
        userId: CANDIDATE_B,
        deletionMode: 'SOFT',
        isDeleted: true,
        replacementDefaultCvId: CV_B2,
        aggregateVersion: 2,
      },
    );
    assert.ok(Number.isFinite(Date.parse(deleted.deletedAt)));

    const usageCall = usageRequests.at(callsBefore);
    assert.equal(usageRequests.length, callsBefore + 1);
    assert.equal(usageCall.method, 'POST');
    assert.equal(usageCall.url, '/internal/v1/cv-usages/lookup');
    assert.equal(
      usageCall.headers['x-internal-api-key'],
      APPLICATION_OUTBOUND_KEY,
    );
    assert.equal(
      usageCall.headers['x-internal-service'],
      'profile-service',
    );
    assert.deepEqual(usageCall.body, {
      candidateId: CANDIDATE_B,
      cvId: CV_B1,
    });

    const row = await prisma.cv.findUniqueOrThrow({ where: { id: CV_B1 } });
    assert.equal(row.isDeleted, true);
    assert.equal(row.isDefault, false);
    assert.equal(row.firstUsedAt.toISOString(), USED_AT_B1);
    assert.equal(row.mediaReferenceId, mediaReferenceBefore);
    const active = await prisma.cv.findMany({
      where: { userId: CANDIDATE_B, isDeleted: false },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    assert.equal(active.filter((cv) => cv.isDefault).length, 1);
    assert.equal(active.find((cv) => cv.isDefault).id, CV_B2);
    assert.equal(
      active.find((cv) => cv.id === CV_B2).aggregateVersion,
      2,
      'the replacement default revision must be versioned',
    );
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_B },
        })
      ).aggregateVersion,
      2,
      'soft-delete and reassignment are one logical Profile mutation',
    );

    const internal = expectSuccess(
      await api(
        'GET',
        `/internal/v1/candidates/${CANDIDATE_B}/cvs/${CV_B1}`,
        null,
        undefined,
        {
          'x-internal-api-key': APPLICATION_INBOUND_KEY,
          'x-internal-service': 'application-service',
        },
      ),
    );
    assert.equal(internal.cvId, CV_B1);
    assert.equal(internal.isDeleted, true);
    assert.equal(internal.firstUsedAt, USED_AT_B1);
    assert.equal(internal.fileId, row.fileId);
    assert.equal('mediaReferenceId' in internal, false);
  });

  await t.test('non-default, last, and repeated deletes preserve revisions without extra lookups', async () => {
    const c2Reference = (
      await prisma.cv.findUniqueOrThrow({ where: { id: CV_C2 } })
    ).mediaReferenceId;
    const callsBefore = usageRequests.length;
    const nonDefault = expectSuccess(
      await api('DELETE', `/cv/${CV_C2}`, tokenC, {
        expectedAggregateVersion: 1,
      }),
    );
    assert.equal(nonDefault.replacementDefaultCvId, null);
    assert.equal(nonDefault.aggregateVersion, 2);
    assert.equal(usageRequests.length, callsBefore + 1);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_C },
        })
      ).aggregateVersion,
      2,
    );

    const repeated = expectSuccess(
      await api('DELETE', `/cvs/${CV_C2}`, tokenC, {
        expectedAggregateVersion: 1,
      }),
    );
    assert.equal(repeated.id, CV_C2);
    assert.equal(repeated.aggregateVersion, 2);
    assert.equal(repeated.replacementDefaultCvId, null);
    assert.equal(usageRequests.length, callsBefore + 1);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_C },
        })
      ).aggregateVersion,
      2,
      'repeated delete must not bump Profile',
    );

    const last = expectSuccess(
      await api('DELETE', `/cvs/${CV_C1}`, tokenC, {
        expectedAggregateVersion: 1,
      }),
    );
    assert.equal(last.replacementDefaultCvId, null);
    assert.equal(usageRequests.length, callsBefore + 2);
    const rows = await prisma.cv.findMany({
      where: { userId: CANDIDATE_C },
    });
    assert.equal(rows.every((cv) => cv.isDeleted), true);
    assert.equal(rows.filter((cv) => cv.isDefault).length, 0);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_C },
        })
      ).aggregateVersion,
      3,
    );
    assert.equal(
      rows.find((cv) => cv.id === CV_C2).mediaReferenceId,
      c2Reference,
    );
  });

  await t.test('stale or foreign deletes avoid usage lookup and upstream failures never mutate', async () => {
    const profileBefore = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_D },
    });

    const callsBeforeStale = usageRequests.length;
    const stale = await api('DELETE', `/cvs/${CV_D3}`, tokenD, {
      expectedAggregateVersion: 99,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'CV_VERSION_CONFLICT');
    assert.equal(usageRequests.length, callsBeforeStale);

    const idor = await api('DELETE', `/cv/${CV_D3}`, otherToken, {
      expectedAggregateVersion: 1,
    });
    assert.equal(idor.status, 404);
    assert.equal(idor.body.code, 'CV_NOT_FOUND');
    assert.equal(usageRequests.length, callsBeforeStale);

    const outage = await api('DELETE', `/cvs/${CV_D1}`, tokenD, {
      expectedAggregateVersion: 1,
    });
    assert.equal(outage.status, 503);
    assert.equal(outage.body.code, 'APPLICATION_SERVICE_UNAVAILABLE');

    const invalid = await api('DELETE', `/cvs/${CV_D2}`, tokenD, {
      expectedAggregateVersion: 1,
    });
    assert.equal(invalid.status, 503);
    assert.equal(invalid.body.code, 'APPLICATION_SERVICE_BAD_RESPONSE');

    const invalidTimeline = await api(
      'DELETE',
      `/cvs/${CV_D3}`,
      tokenD,
      { expectedAggregateVersion: 1 },
    );
    assert.equal(invalidTimeline.status, 503);
    assert.equal(
      invalidTimeline.body.code,
      'APPLICATION_CV_USAGE_INVALID',
    );

    const rows = await prisma.cv.findMany({
      where: { userId: CANDIDATE_D },
    });
    assert.equal(rows.every((cv) => !cv.isDeleted), true);
    assert.equal(rows.every((cv) => cv.aggregateVersion === 1), true);
    assert.equal(rows.every((cv) => cv.firstUsedAt === null), true);
    assert.equal(rows.filter((cv) => cv.isDefault).length, 1);
    assert.equal(
      (
        await prisma.profile.findUniqueOrThrow({
          where: { userId: CANDIDATE_D },
        })
      ).aggregateVersion,
      profileBefore.aggregateVersion,
    );
  });

  await t.test('database rejects direct SQL that removes the last default or hard-deletes a CV', async () => {
    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          UPDATE "profile"."cvs"
          SET "is_default" = false
          WHERE "user_id" = ${CANDIDATE_E}::uuid
        `;
        await transaction.$executeRawUnsafe(
          'SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE',
        );
      }),
      (error) => {
        assert.match(
          databaseErrorText(error),
          /active CV set must have exactly one default/i,
        );
        return true;
      },
    );
    assert.equal(
      (
        await prisma.cv.findUniqueOrThrow({ where: { id: CV_E1 } })
      ).isDefault,
      true,
    );

    await assert.rejects(
      prisma.$executeRaw`
        DELETE FROM "profile"."cvs"
        WHERE "id" = ${CV_E2}::uuid
      `,
      (error) => {
        assert.match(databaseErrorText(error), /hard delete is disabled/i);
        return true;
      },
    );
    assert.equal(
      await prisma.cv.count({ where: { userId: CANDIDATE_E } }),
      2,
    );
  });

  await t.test('Swagger publishes canonical lifecycle paths and compatibility aliases', async () => {
    const swagger = await api('GET', '/docs-json');
    assert.equal(swagger.status, 200, JSON.stringify(swagger.body));
    for (const path of ['/cvs/{id}', '/cv/{id}']) {
      assert.ok(swagger.body.paths[path]?.patch, `missing PATCH ${path}`);
      assert.ok(swagger.body.paths[path]?.delete, `missing DELETE ${path}`);
    }
    for (const path of [
      '/cvs/{id}/default',
      '/cv/{id}/default',
    ]) {
      assert.ok(swagger.body.paths[path]?.patch, `missing PATCH ${path}`);
    }
  });
});
