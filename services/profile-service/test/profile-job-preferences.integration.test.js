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
const { PrismaClient } = require('@prisma/client');
const {
  assertSafeTestDatabase,
} = require('./test-database-safety');

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const APPLICATION_KEY =
  'profile-preferences-application-key-000000000001';
const CANDIDATE_A = '10000000-0000-4000-8000-000000000091';
const CANDIDATE_B = '10000000-0000-4000-8000-000000000092';
const CANDIDATE_C = '10000000-0000-4000-8000-000000000093';

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
process.env.MEDIA_SERVICE_URL = 'http://media-service.invalid:3000';
process.env.MEDIA_INTERNAL_API_KEY =
  'profile-preferences-media-key-0000000000000001';
process.env.APPLICATION_SERVICE_URL =
  'http://application-service.invalid:8080';
process.env.APPLICATION_INTERNAL_API_KEY =
  'profile-preferences-outbound-key-000000000001';
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

const request = async (method, path, token, body) => {
  const headers = { accept: 'application/json' };
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
    cacheControl: response.headers.get('cache-control'),
    pragma: response.headers.get('pragma'),
    vary: response.headers.get('vary'),
  };
};

const enabled = (expectedVersion, overrides = {}) => ({
  expectedVersion,
  state: 'ENABLED',
  consentVersion: 1,
  targetRoles: [' Backend   Engineer '],
  preferredLocations: [' Ha\u00a0Noi '],
  preferredJobTypes: ['FULL_TIME', 'REMOTE'],
  minimumSalary: '20000000',
  ...overrides,
});

const disabled = (expectedVersion) => ({
  expectedVersion,
  state: 'DISABLED',
  consentVersion: null,
  targetRoles: [],
  preferredLocations: [],
  preferredJobTypes: [],
  minimumSalary: null,
});

const success = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.meta, null);
  assert.match(response.cacheControl, /private/);
  assert.match(response.cacheControl, /no-store/);
  assert.equal(response.pragma, 'no-cache');
  assert.match(response.vary, /Authorization/i);
  return response.body.data;
};

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."cv_event_outbox", "profile"."profiles" CASCADE',
  );
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

test('Candidate job preferences contract on PostgreSQL 16', async (t) => {
  const candidateToken = accessToken(CANDIDATE_A);

  await t.test('GET is Candidate-only, Swagger-visible and virtual UNSET never creates a profile', async () => {
    const withoutToken = await request('GET', '/job-preferences');
    assert.equal(withoutToken.status, 401);

    const recruiter = await request(
      'GET',
      '/job-preferences',
      accessToken(CANDIDATE_A, 'RECRUITER'),
    );
    assert.equal(recruiter.status, 403);

    const response = await request(
      'GET',
      '/job-preferences',
      candidateToken,
    );
    const preference = success(response);
    assert.deepEqual(preference, {
      schemaVersion: 1,
      candidateId: CANDIDATE_A,
      state: 'UNSET',
      version: 0,
      consentVersion: null,
      consentedAt: null,
      withdrawnAt: null,
      targetRoles: [],
      preferredLocations: [],
      preferredJobTypes: [],
      minimumSalary: null,
      currency: 'VND',
      createdAt: null,
      updatedAt: null,
    });
    assert.equal(
      await prisma.profile.count({ where: { userId: CANDIDATE_A } }),
      0,
    );

    const swagger = await request('GET', '/docs-json');
    assert.equal(swagger.status, 200);
    assert.ok(swagger.body.paths['/job-preferences'].get);
    assert.ok(swagger.body.paths['/job-preferences'].put);
    assert.equal(swagger.body.paths['/job-preferences'].delete, undefined);
    const responseSchema =
      swagger.body.components.schemas.JobPreferenceResponseDto;
    const requestSchema =
      swagger.body.components.schemas.PutJobPreferenceDto;
    const v1JobTypes = [
      'FULL_TIME',
      'PART_TIME',
      'REMOTE',
      'INTERNSHIP',
    ];
    assert.deepEqual(
      requestSchema.properties.preferredJobTypes.items.enum,
      v1JobTypes,
    );
    assert.deepEqual(
      responseSchema.properties.preferredJobTypes.items.enum,
      v1JobTypes,
    );
    assert.deepEqual(
      [...responseSchema.required].sort(),
      [
        'candidateId',
        'consentVersion',
        'consentedAt',
        'createdAt',
        'currency',
        'minimumSalary',
        'preferredJobTypes',
        'preferredLocations',
        'schemaVersion',
        'state',
        'targetRoles',
        'updatedAt',
        'version',
        'withdrawnAt',
      ].sort(),
    );
  });

  let consentedAt;
  await t.test('PUT lazily creates Profile, canonicalizes data and owns a separate version', async () => {
    const response = await request(
      'PUT',
      '/job-preferences',
      candidateToken,
      enabled(0),
    );
    const preference = success(response);
    assert.deepEqual(preference.targetRoles, ['Backend Engineer']);
    assert.deepEqual(preference.preferredLocations, ['Ha Noi']);
    assert.equal(preference.minimumSalary, '20000000.00');
    assert.equal(preference.state, 'ENABLED');
    assert.equal(preference.version, 1);
    assert.equal(preference.consentVersion, 1);
    assert.ok(preference.consentedAt);
    assert.equal(preference.withdrawnAt, null);
    consentedAt = preference.consentedAt;

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(profile.aggregateVersion, 1);
    assert.equal(profile.completionPercent, 0);
    assert.equal(profile.headline, null);
    assert.equal(await prisma.skill.count({ where: { profileId: profile.id } }), 0);
  });

  await t.test('ENABLED edit preserves consent time and stale CAS changes nothing', async () => {
    const edited = success(await request(
      'PUT',
      '/job-preferences',
      candidateToken,
      enabled(1, {
        targetRoles: ['Platform Engineer'],
        preferredLocations: [],
        preferredJobTypes: ['REMOTE'],
        minimumSalary: null,
      }),
    ));
    assert.equal(edited.version, 2);
    assert.equal(edited.consentedAt, consentedAt);

    const stale = await request(
      'PUT',
      '/job-preferences',
      candidateToken,
      enabled(1, { targetRoles: ['Stale value'] }),
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'JOB_PREFERENCE_VERSION_CONFLICT');
    assert.deepEqual(stale.body.details, {
      expectedVersion: 1,
      actualVersion: 2,
    });
    const current = success(await request(
      'GET',
      '/job-preferences',
      candidateToken,
    ));
    assert.deepEqual(current.targetRoles, ['Platform Engineer']);
    assert.equal(current.version, 2);
  });

  await t.test('DISABLED clears every criterion and re-enable records fresh consent', async () => {
    const turnedOff = success(await request(
      'PUT',
      '/job-preferences',
      candidateToken,
      disabled(2),
    ));
    assert.equal(turnedOff.state, 'DISABLED');
    assert.equal(turnedOff.version, 3);
    assert.equal(turnedOff.consentVersion, null);
    assert.equal(turnedOff.consentedAt, consentedAt);
    assert.ok(turnedOff.withdrawnAt);
    assert.deepEqual(turnedOff.targetRoles, []);
    assert.deepEqual(turnedOff.preferredLocations, []);
    assert.deepEqual(turnedOff.preferredJobTypes, []);
    assert.equal(turnedOff.minimumSalary, null);

    const invalidDisabled = await request(
      'PUT',
      '/job-preferences',
      candidateToken,
      { ...disabled(3), targetRoles: ['Must be cleared'] },
    );
    assert.equal(invalidDisabled.status, 400);
    assert.equal(invalidDisabled.body.code, 'JOB_PREFERENCE_INVALID');

    await new Promise((resolve) => setTimeout(resolve, 5));
    const turnedOn = success(await request(
      'PUT',
      '/job-preferences',
      candidateToken,
      enabled(3, {
        targetRoles: ['Data Engineer'],
        preferredLocations: [],
        preferredJobTypes: [],
        minimumSalary: null,
      }),
    ));
    assert.equal(turnedOn.version, 4);
    assert.equal(turnedOn.withdrawnAt, null);
    assert.notEqual(turnedOn.consentedAt, consentedAt);
  });

  await t.test('HTTP rejects exact-match metacharacters and unsafe Unicode', async () => {
    const unsafeInputs = [
      enabled(4, { targetRoles: ['100% Engineer'] }),
      enabled(4, { preferredLocations: ['Ha_Noi'] }),
      enabled(4, { targetRoles: ['Path\\Role'] }),
      enabled(4, { targetRoles: ['\ud800'] }),
    ];
    for (const input of unsafeInputs) {
      const response = await request(
        'PUT',
        '/job-preferences',
        candidateToken,
        input,
      );
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body.code, 'VALIDATION_ERROR');
    }
    const current = success(await request(
      'GET',
      '/job-preferences',
      candidateToken,
    ));
    assert.equal(current.version, 4);
  });

  await t.test('two create requests with expected version zero produce one success and one conflict', async () => {
    const token = accessToken(CANDIDATE_B);
    const responses = await Promise.all([
      request('PUT', '/job-preferences', token, enabled(0)),
      request('PUT', '/job-preferences', token, enabled(0)),
    ]);
    assert.deepEqual(
      responses.map(({ status }) => status).sort(),
      [200, 409],
    );
    const conflict = responses.find(({ status }) => status === 409);
    assert.equal(conflict.body.code, 'JOB_PREFERENCE_VERSION_CONFLICT');
    assert.equal(
      await prisma.candidateJobPreference.count({
        where: { candidateId: CANDIDATE_B },
      }),
      1,
    );
  });

  await t.test('database constraints reject metacharacters, caps, duplicates and invalid state tuples', async () => {
    await prisma.profile.create({ data: { userId: CANDIDATE_C } });
    for (const unsafeValue of ['100% Engineer', 'Ha_Noi', 'Path\\Role']) {
      const rows = await prisma.$queryRaw`
        SELECT "profile"."job_preference_text_array_is_valid"(
          ARRAY[${unsafeValue}]::text[], 10, 120
        ) AS "valid"
      `;
      assert.equal(rows[0].valid, false, unsafeValue);
    }
    const invalidStatements = [
      `
        INSERT INTO "profile"."candidate_job_preferences" (
          "candidate_id", "state", "consent_version", "consented_at",
          "target_roles", "preferred_locations", "preferred_job_types",
          "updated_at"
        ) VALUES (
          '${CANDIDATE_C}'::uuid, 'ENABLED', 1, CURRENT_TIMESTAMP,
          ARRAY['NestJS', 'NESTJS'], ARRAY[]::text[],
          ARRAY[]::"profile"."preferred_job_type"[], CURRENT_TIMESTAMP
        )
      `,
      `
        INSERT INTO "profile"."candidate_job_preferences" (
          "candidate_id", "state", "consent_version", "consented_at",
          "target_roles", "preferred_locations", "preferred_job_types",
          "updated_at"
        ) VALUES (
          '${CANDIDATE_C}'::uuid, 'ENABLED', 1, CURRENT_TIMESTAMP,
          ARRAY[${Array.from({ length: 11 }, (_, i) => `'Role ${i}'`).join(',')}],
          ARRAY[]::text[], ARRAY[]::"profile"."preferred_job_type"[],
          CURRENT_TIMESTAMP
        )
      `,
      `
        INSERT INTO "profile"."candidate_job_preferences" (
          "candidate_id", "state", "consent_version", "consented_at",
          "withdrawn_at", "target_roles", "preferred_locations",
          "preferred_job_types", "updated_at"
        ) VALUES (
          '${CANDIDATE_C}'::uuid, 'DISABLED', NULL, NULL,
          CURRENT_TIMESTAMP, ARRAY['Retained value'], ARRAY[]::text[],
          ARRAY[]::"profile"."preferred_job_type"[], CURRENT_TIMESTAMP
        )
      `,
      `
        INSERT INTO "profile"."candidate_job_preferences" (
          "candidate_id", "state", "consent_version", "consented_at",
          "target_roles", "preferred_locations", "preferred_job_types",
          "minimum_salary", "updated_at"
        ) VALUES (
          '${CANDIDATE_C}'::uuid, 'ENABLED', 1, CURRENT_TIMESTAMP,
          ARRAY[E'Bad\\001Role'], ARRAY[]::text[],
          ARRAY[]::"profile"."preferred_job_type"[], 0, CURRENT_TIMESTAMP
        )
      `,
    ];
    for (const statement of invalidStatements) {
      await assert.rejects(() => prisma.$executeRawUnsafe(statement));
    }
    assert.equal(
      await prisma.candidateJobPreference.count({
        where: { candidateId: CANDIDATE_C },
      }),
      0,
    );

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(profile.aggregateVersion, 1);
    assert.equal(profile.completionPercent, 0);
  });
});
