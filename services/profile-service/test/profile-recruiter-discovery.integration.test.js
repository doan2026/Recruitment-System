'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
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
  CvType,
  JobPreferenceState,
  PreferredJobType,
  PrismaClient,
} = require('@prisma/client');
const {
  assertSafeTestDatabase,
} = require('./test-database-safety');

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const APPLICATION_KEY =
  'profile-discovery-application-key-000000000001';
const JOB_SEARCH_KEY =
  'profile-discovery-job-search-key-000000000001';
const PURPOSE = 'RECRUITER_JOB_RECOMMENDATION';
const CANDIDATE_A = '11000000-0000-4000-8000-0000000000a1';
const CANDIDATE_B = '11000000-0000-4000-8000-0000000000b1';
const CANDIDATE_C = '11000000-0000-4000-8000-0000000000c1';
const CANDIDATE_D = '11000000-0000-4000-8000-0000000000d1';
const CV_A = '21000000-0000-4000-8000-0000000000a1';
const LEGACY_CV_A = '21000000-0000-4000-8000-0000000000a2';
const CV_B = '21000000-0000-4000-8000-0000000000b1';
const CV_C = '21000000-0000-4000-8000-0000000000c1';

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
process.env.INTERNAL_API_KEY_JOB_SEARCH = JOB_SEARCH_KEY;
process.env.MEDIA_SERVICE_URL = 'http://media-service.invalid:3000';
process.env.MEDIA_INTERNAL_API_KEY =
  'profile-discovery-media-key-0000000000000001';
process.env.APPLICATION_SERVICE_URL =
  'http://application-service.invalid:8080';
process.env.APPLICATION_INTERNAL_API_KEY =
  'profile-discovery-outbound-key-0000000000001';
process.env.CV_DELETION_RECONCILE_ENABLED = 'false';
process.env.CV_MEDIA_CLEANUP_ENABLED = 'false';
process.env.CV_EVENT_PUBLISHER_ENABLED = 'false';
process.env.SWAGGER_ENABLED = 'true';

const { AppModule } = require('../dist/app.module');
const { configureApplication } = require('../dist/main');

const prisma = new PrismaClient();
const jwt = new JwtService();
let app;
let baseUrl;
let canResetSchema = false;

const accessToken = (candidateId, role = 'CANDIDATE') =>
  jwt.sign(
    { role },
    {
      privateKey: privateKeyPem,
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: candidateId,
      jwtid: randomUUID(),
      expiresIn: '15m',
      header: { kid, typ: 'JWT' },
    },
  );

const internalHeaders = (service, key) => ({
  'x-internal-service': service,
  'x-internal-api-key': key,
});

const api = async (method, path, options = {}) => {
  const headers = {
    accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
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
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
};

const success = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.meta, null);
  assert.match(response.headers.get('cache-control'), /private/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  return response.body.data;
};

const enable = (expectedVersion, cvId) => ({
  expectedVersion,
  state: 'ENABLED',
  purpose: PURPOSE,
  consentVersion: 1,
  cvId,
});

const disable = (expectedVersion) => ({
  expectedVersion,
  state: 'DISABLED',
  purpose: PURPOSE,
  consentVersion: null,
  cvId: null,
});

const internalRequest = (body, headers = {}) => ({
  body,
  headers: {
    ...internalHeaders('job-search-service', JOB_SEARCH_KEY),
    ...headers,
  },
});

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."cv_event_outbox", "profile"."profiles" CASCADE',
  );

  const profiles = await Promise.all([
    prisma.profile.create({
      data: {
        userId: CANDIDATE_A,
        fullName: 'Candidate A',
        headline: 'Platform Engineer',
        summary: 'Never share this biography',
        phone: '+84999999999',
        address: 'Never share this address',
        linkedinUrl: 'https://www.linkedin.com/in/candidate-a',
        aggregateVersion: 5,
      },
    }),
    prisma.profile.create({
      data: {
        userId: CANDIDATE_B,
        fullName: 'Candidate B',
        headline: null,
      },
    }),
    prisma.profile.create({
      data: {
        userId: CANDIDATE_C,
        fullName: 'Candidate C',
        headline: 'Default CV must not imply consent',
      },
    }),
  ]);
  await prisma.skill.createMany({
    data: [
      {
        id: '31000000-0000-4000-8000-0000000000a2',
        profileId: profiles[0].id,
        name: 'PostgreSQL',
        normalizedName: 'postgresql',
        sortOrder: 2,
      },
      {
        id: '31000000-0000-4000-8000-0000000000a1',
        profileId: profiles[0].id,
        name: 'TypeScript',
        normalizedName: 'typescript',
        sortOrder: 1,
      },
    ],
  });
  await prisma.cv.createMany({
    data: [
      {
        id: CV_A,
        userId: CANDIDATE_A,
        title: 'Candidate A private CV',
        type: CvType.UPLOAD,
        fileId: '41000000-0000-4000-8000-0000000000a1',
        mediaReferenceId: '51000000-0000-4000-8000-0000000000a1',
        isDefault: true,
      },
      {
        id: LEGACY_CV_A,
        userId: CANDIDATE_A,
        title: 'Candidate A legacy CV',
        type: CvType.UPLOAD,
        fileId: '41000000-0000-4000-8000-0000000000a2',
        fileUrl: 'https://legacy.example/candidate-a.pdf',
        mediaReferenceId: null,
      },
      {
        id: CV_B,
        userId: CANDIDATE_B,
        title: 'Candidate B private CV',
        type: CvType.UPLOAD,
        fileId: '41000000-0000-4000-8000-0000000000b1',
        mediaReferenceId: '51000000-0000-4000-8000-0000000000b1',
        isDefault: true,
      },
      {
        id: CV_C,
        userId: CANDIDATE_C,
        title: 'Candidate C default private CV',
        type: CvType.UPLOAD,
        fileId: '41000000-0000-4000-8000-0000000000c1',
        mediaReferenceId: '51000000-0000-4000-8000-0000000000c1',
        isDefault: true,
      },
    ],
  });
  const jobPreferenceTime = new Date();
  await prisma.candidateJobPreference.create({
    data: {
      candidateId: CANDIDATE_C,
      state: JobPreferenceState.ENABLED,
      consentVersion: 1,
      consentedAt: jobPreferenceTime,
      targetRoles: ['Backend Engineer'],
      preferredJobTypes: [PreferredJobType.FULL_TIME],
      createdAt: jobPreferenceTime,
      updatedAt: jobPreferenceTime,
    },
  });

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
  } finally {
    await prisma.$disconnect();
  }
});

test('Candidate recruiter discovery and Job-scoped projection contract on PostgreSQL 16', async (t) => {
  const tokenA = accessToken(CANDIDATE_A);

  await t.test('public contract is Candidate-only, Swagger-visible and starts virtual UNSET without persistence', async () => {
    assert.equal((await api('GET', '/recruiter-discovery')).status, 401);
    assert.equal((await api('GET', '/recruiter-discovery', {
      token: accessToken(CANDIDATE_A, 'RECRUITER'),
    })).status, 403);

    const unset = success(await api('GET', '/recruiter-discovery', {
      token: accessToken(CANDIDATE_D),
    }));
    assert.deepEqual(unset, {
      schemaVersion: 1,
      purpose: PURPOSE,
      sharedFields: ['FULL_NAME', 'HEADLINE', 'SKILLS'],
      candidateId: CANDIDATE_D,
      state: 'UNSET',
      version: 0,
      consentVersion: null,
      cvId: null,
      consentedAt: null,
      withdrawnAt: null,
      createdAt: null,
      updatedAt: null,
    });
    assert.equal(
      await prisma.profile.count({ where: { userId: CANDIDATE_D } }),
      0,
    );

    const swagger = await api('GET', '/docs-json');
    assert.equal(swagger.status, 200);
    assert.ok(swagger.body.paths['/recruiter-discovery'].get);
    assert.ok(swagger.body.paths['/recruiter-discovery'].put);
    assert.equal(
      swagger.body.paths['/internal/v1/recruiter-discovery/snapshot'],
      undefined,
    );
  });

  await t.test('ENABLED requires one explicit active owned Media-backed CV and independent CAS', async () => {
    for (const cvId of [CV_B, LEGACY_CV_A]) {
      const rejected = await api('PUT', '/recruiter-discovery', {
        token: tokenA,
        body: enable(0, cvId),
      });
      assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
      assert.equal(
        rejected.body.code,
        'RECRUITER_DISCOVERY_CV_NOT_AVAILABLE',
      );
    }

    const enabled = success(await api('PUT', '/recruiter-discovery', {
      token: tokenA,
      body: enable(0, CV_A.toUpperCase()),
    }));
    assert.equal(enabled.state, 'ENABLED');
    assert.equal(enabled.version, 1);
    assert.equal(enabled.cvId, CV_A);
    assert.equal(enabled.consentVersion, 1);
    assert.ok(enabled.consentedAt);
    assert.equal(enabled.withdrawnAt, null);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(profile.aggregateVersion, 5);
    const stale = await api('PUT', '/recruiter-discovery', {
      token: tokenA,
      body: enable(0, CV_A),
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'RECRUITER_DISCOVERY_VERSION_CONFLICT');
  });

  let firstSnapshot;
  await t.test('internal endpoints require only the distinct Job Search credential and snapshot explicit consent deterministically', async () => {
    const snapshotBody = { schemaVersion: 1, purpose: PURPOSE };
    assert.equal((await api(
      'POST',
      '/internal/v1/recruiter-discovery/snapshot',
      { body: snapshotBody },
    )).status, 401);
    assert.equal((await api(
      'POST',
      '/internal/v1/recruiter-discovery/snapshot',
      {
        body: snapshotBody,
        headers: internalHeaders('application-service', APPLICATION_KEY),
      },
    )).status, 401);
    assert.equal((await api(
      'POST',
      '/internal/v1/recruiter-discovery/snapshot',
      { body: snapshotBody, token: accessToken(CANDIDATE_A, 'RECRUITER') },
    )).status, 401);

    const response = await api(
      'POST',
      '/internal/v1/recruiter-discovery/snapshot',
      internalRequest(snapshotBody),
    );
    firstSnapshot = success(response);
    assert.deepEqual(firstSnapshot, {
      schemaVersion: 1,
      purpose: PURPOSE,
      candidates: [{
        candidateId: CANDIDATE_A,
        cvId: CV_A,
        discoveryVersion: 1,
        profileVersion: 5,
      }],
    });
    assert.equal(
      firstSnapshot.candidates.some(({ candidateId }) =>
        candidateId === CANDIDATE_C
      ),
      false,
    );

    const applicationOnly = await api(
      'GET',
      `/internal/v1/candidates/${CANDIDATE_A}/cvs`,
      { headers: internalHeaders('job-search-service', JOB_SEARCH_KEY) },
    );
    assert.equal(applicationOnly.status, 401);
    assert.equal(applicationOnly.body.code, 'INTERNAL_AUTH_INVALID');
  });

  await t.test('resolver returns only canonical safe fields, preserves order and omits stale versions', async () => {
    const expectation = firstSnapshot.candidates[0];
    const resolved = success(await api(
      'POST',
      '/internal/v1/recruiter-discovery/resolve',
      internalRequest({
        schemaVersion: 1,
        purpose: PURPOSE,
        candidates: [expectation],
      }),
    ));
    assert.deepEqual(resolved, {
      schemaVersion: 1,
      purpose: PURPOSE,
      candidates: [{
        candidateId: CANDIDATE_A,
        fullName: 'Candidate A',
        headline: 'Platform Engineer',
        skills: ['TypeScript', 'PostgreSQL'],
      }],
    });
    assert.deepEqual(Object.keys(resolved.candidates[0]).sort(), [
      'candidateId',
      'fullName',
      'headline',
      'skills',
    ]);
    for (const forbidden of [
      'avatarUrl',
      'phone',
      'address',
      'summary',
      'linkedinUrl',
      'cvId',
      'fileId',
      'contentJson',
    ]) {
      assert.equal(forbidden in resolved.candidates[0], false, forbidden);
    }

    await prisma.profile.update({
      where: { userId: CANDIDATE_A },
      data: {
        headline: 'Principal Engineer',
        aggregateVersion: { increment: 1 },
      },
    });
    const stale = success(await api(
      'POST',
      '/internal/v1/recruiter-discovery/resolve',
      internalRequest({
        schemaVersion: 1,
        purpose: PURPOSE,
        candidates: [expectation],
      }),
    ));
    assert.deepEqual(stale.candidates, []);

    const malformed = await api(
      'POST',
      '/internal/v1/recruiter-discovery/resolve',
      internalRequest({
        schemaVersion: 1,
        purpose: PURPOSE,
        candidates: [expectation],
        candidateContact: true,
      }),
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'VALIDATION_ERROR');
  });

  await t.test('withdrawal and CV deletion immediately remove discovery and stale resolver access', async () => {
    const freshSnapshot = success(await api(
      'POST',
      '/internal/v1/recruiter-discovery/snapshot',
      internalRequest({ schemaVersion: 1, purpose: PURPOSE }),
    ));
    assert.equal(freshSnapshot.candidates[0].profileVersion, 6);

    const disabled = success(await api('PUT', '/recruiter-discovery', {
      token: tokenA,
      body: disable(1),
    }));
    assert.equal(disabled.state, 'DISABLED');
    assert.equal(disabled.version, 2);
    assert.equal(disabled.cvId, null);
    assert.ok(disabled.withdrawnAt);

    const afterWithdrawal = success(await api(
      'POST',
      '/internal/v1/recruiter-discovery/snapshot',
      internalRequest({ schemaVersion: 1, purpose: PURPOSE }),
    ));
    assert.deepEqual(afterWithdrawal.candidates, []);
    const stale = success(await api(
      'POST',
      '/internal/v1/recruiter-discovery/resolve',
      internalRequest({
        schemaVersion: 1,
        purpose: PURPOSE,
        candidates: [freshSnapshot.candidates[0]],
      }),
    ));
    assert.deepEqual(stale.candidates, []);

    const reenabled = success(await api('PUT', '/recruiter-discovery', {
      token: tokenA,
      body: enable(2, CV_A),
    }));
    assert.equal(reenabled.version, 3);
    assert.equal(reenabled.state, 'ENABLED');
    await prisma.$transaction(async (transaction) => {
      await transaction.cv.update({
        where: { id: CV_A },
        data: {
          isDefault: false,
          isDeleted: true,
          deletedAt: new Date(),
          aggregateVersion: { increment: 1 },
        },
      });
      await transaction.cv.update({
        where: { id: LEGACY_CV_A },
        data: { isDefault: true },
      });
      await transaction.$executeRawUnsafe(
        'SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE',
      );
    });
    const afterDelete = success(await api(
      'POST',
      '/internal/v1/recruiter-discovery/snapshot',
      internalRequest({ schemaVersion: 1, purpose: PURPOSE }),
    ));
    assert.deepEqual(afterDelete.candidates, []);
  });

  await t.test('concurrent first decisions serialize to one success and one CAS conflict', async () => {
    const tokenB = accessToken(CANDIDATE_B);
    const responses = await Promise.all([
      api('PUT', '/recruiter-discovery', {
        token: tokenB,
        body: enable(0, CV_B),
      }),
      api('PUT', '/recruiter-discovery', {
        token: tokenB,
        body: enable(0, CV_B),
      }),
    ]);
    assert.deepEqual(
      responses.map(({ status }) => status).sort(),
      [200, 409],
    );
    assert.equal(
      responses.find(({ status }) => status === 409).body.code,
      'RECRUITER_DISCOVERY_VERSION_CONFLICT',
    );
    assert.equal(await prisma.candidateRecruiterDiscovery.count({
      where: { candidateId: CANDIDATE_B },
    }), 1);
  });
});
