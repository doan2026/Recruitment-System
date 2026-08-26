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
const CANDIDATE_A = '10000000-0000-4000-8000-000000000011';
const CANDIDATE_B = '10000000-0000-4000-8000-000000000012';
const CANDIDATE_C = '10000000-0000-4000-8000-000000000013';
const CANDIDATE_D = '10000000-0000-4000-8000-000000000014';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privateKeyPem = privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const publicKeyPem = publicKey.export({
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

process.env.JWT_PUBLIC_KEY = publicKeyPem;
process.env.JWT_PUBLIC_KEY_PATH = '';
process.env.JWT_JWKS_URI = '';
process.env.JWT_ISSUER = ISSUER;
process.env.JWT_AUDIENCE = AUDIENCE;
process.env.CORS_ORIGINS = 'http://localhost:3000';

const { AppModule } = require('../dist/app.module');
const { configureApplication } = require('../dist/main');
const {
  PROFILE_COLLECTION_LIMITS,
} = require('../dist/profile/profile.service');

const prisma = new PrismaClient();
const jwt = new JwtService();
let app;
let baseUrl;
let canResetSchema = false;

const accessToken = (
  subject,
  role = 'CANDIDATE',
  overrides = {},
) =>
  jwt.sign(
    { role, ...overrides.payload },
    {
      privateKey: privateKeyPem,
      algorithm: 'RS256',
      issuer: overrides.issuer ?? ISSUER,
      audience: overrides.audience ?? AUDIENCE,
      subject,
      jwtid: Object.hasOwn(overrides, 'jti')
        ? overrides.jti
        : randomUUID(),
      expiresIn: overrides.expiresIn ?? '15m',
      header: {
        kid: overrides.kid ?? kid,
        typ: overrides.typ ?? 'JWT',
      },
    },
  );

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
    cacheControl: response.headers.get('cache-control'),
  };
};

const expectSuccess = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.ok(response.body);
  assert.ok(Object.hasOwn(response.body, 'data'));
  assert.equal(response.body.meta, null);
  assert.match(response.cacheControl, /no-store/);
  return response.body.data;
};

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."profiles" CASCADE',
  );
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  baseUrl = 'http://127.0.0.1:' + address.port;
});

after(async () => {
  try {
    if (canResetSchema) {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "profile"."profiles" CASCADE',
      );
    }
    if (app) {
      await app.close();
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('Candidate Profile CRUD API on PostgreSQL 16', async (t) => {
  const candidateToken = accessToken(CANDIDATE_A);
  const recruiterToken = accessToken(CANDIDATE_A, 'RECRUITER');

  await t.test('health is public while profile routes are deny-by-default', async () => {
    const health = await api('GET', '/health');
    const healthData = expectSuccess(health);
    assert.deepEqual(healthData, {
      service: 'profile-service',
      status: 'UP',
    });
    const swagger = await api('GET', '/docs-json');
    assert.equal(swagger.status, 200, JSON.stringify(swagger.body));
    assert.ok(swagger.body.paths['/{userId}']);
    assert.ok(swagger.body.paths['/educations']);
    assert.ok(swagger.body.paths['/experiences']);
    assert.ok(swagger.body.paths['/skills']);
    assert.ok(swagger.body.paths['/education']);
    assert.ok(swagger.body.paths['/experience']);
    assert.ok(swagger.body.paths['/skill']);
    assert.ok(swagger.body.paths['/certificates']);
    assert.ok(swagger.body.paths['/certificate']);
    assert.ok(swagger.body.paths['/projects']);
    assert.ok(swagger.body.paths['/project']);
    const profileSchema =
      swagger.body.components.schemas.ProfileResponseDto;
    for (const field of [
      'fullName',
      'headline',
      'avatarFileId',
      'githubUrl',
    ]) {
      assert.ok(
        profileSchema.required.includes(field),
        field + ' must be required and nullable',
      );
    }
    const errorSchema =
      swagger.body.components.schemas.ApiErrorResponseDto;
    assert.deepEqual(
      [...errorSchema.required].sort(),
      ['code', 'details', 'message'],
    );
    const responses =
      swagger.body.paths['/{userId}'].get.responses;
    for (const status of ['400', '401', '403', '404', '409', '500', '503']) {
      assert.ok(responses[status], 'missing Swagger response ' + status);
    }


    const missingToken = await api(
      'GET',
      '/' + CANDIDATE_A,
    );
    assert.equal(missingToken.status, 401);

    const missingProfile = await api(
      'GET',
      '/' + CANDIDATE_A,
      candidateToken,
    );
    assert.equal(missingProfile.status, 404);

    const wrongRole = await api(
      'PUT',
      '/' + CANDIDATE_A,
      recruiterToken,
      { fullName: 'Recruiter' },
    );
    assert.equal(wrongRole.status, 403);

    const recruiterRead = await api(
      'GET',
      '/' + CANDIDATE_A,
      recruiterToken,
    );
    assert.equal(recruiterRead.status, 403);

    const wrongOwner = await api(
      'PUT',
      '/' + CANDIDATE_B,
      candidateToken,
      { fullName: 'Other user' },
    );
    assert.equal(wrongOwner.status, 403);

    const wrongIssuer = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'CANDIDATE', {
        issuer: 'https://attacker.example',
      }),
    );
    assert.equal(wrongIssuer.status, 401);

    const wrongKid = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'CANDIDATE', {
        kid: 'untrusted-key',
      }),
    );
    assert.equal(wrongKid.status, 401);

    const wrongType = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'CANDIDATE', {
        typ: 'at+jwt',
      }),
    );
    assert.equal(wrongType.status, 401);

    const wrongAudience = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'CANDIDATE', {
        audience: 'other-api',
      }),
    );
    assert.equal(wrongAudience.status, 401);

    const expired = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'CANDIDATE', {
        expiresIn: -1,
      }),
    );
    assert.equal(expired.status, 401);

    const futureIssuedAt = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'CANDIDATE', {
        payload: {
          iat: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    );
    assert.equal(futureIssuedAt.status, 401);

    const invalidSubject = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken('not-a-uuid'),
    );
    assert.equal(invalidSubject.status, 401);

    const invalidJti = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'CANDIDATE', {
        jti: 'not-a-uuid',
      }),
    );
    assert.equal(invalidJti.status, 401);

    const invalidRole = await api(
      'GET',
      '/' + CANDIDATE_A,
      accessToken(CANDIDATE_A, 'ROOT'),
    );
    assert.equal(invalidRole.status, 401);
  });

  await t.test('validation rejects mass assignment and unsafe links', async () => {
    const massAssignment = await api(
      'PUT',
      '/' + CANDIDATE_A,
      candidateToken,
      {
        fullName: 'Candidate A',
        completionPercent: 100,
      },
    );
    assert.equal(massAssignment.status, 400);
    assert.equal(massAssignment.body.code, 'VALIDATION_ERROR');

    const unsafeGithub = await api(
      'PUT',
      '/' + CANDIDATE_A,
      candidateToken,
      { githubUrl: 'https://github.com.attacker.example/user' },
    );
    assert.equal(unsafeGithub.status, 400);

    const invalidCalendarDate = await api(
      'POST',
      '/educations',
      candidateToken,
      {
        school: 'Invalid School',
        startDate: '2025-02-30',
      },
    );
    assert.equal(invalidCalendarDate.status, 400);
    assert.equal(invalidCalendarDate.body.code, 'INVALID_DATE');

    for (const invalidSortOrder of [null, '', true, '1']) {
      const invalidType = await api(
        'POST',
        '/skills',
        candidateToken,
        {
          name: 'Invalid sort order',
          sortOrder: invalidSortOrder,
        },
      );
      assert.equal(
        invalidType.status,
        400,
        'sortOrder=' + JSON.stringify(invalidSortOrder),
      );
    }

    const nullCurrent = await api(
      'POST',
      '/experiences',
      candidateToken,
      {
        companyName: 'Invalid Company',
        position: 'Engineer',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        isCurrent: null,
      },
    );
    assert.equal(nullCurrent.status, 400);
  });

  let educationId;
  let experienceId;
  let skillId;
  let certificateId;
  let projectId;

  await t.test('general profile upsert calculates the first 35 percent', async () => {
    const response = await api(
      'PUT',
      '/' + CANDIDATE_A,
      candidateToken,
      {
        fullName: '  Nguyen Van An  ',
        headline: 'Backend Engineer',
        summary: 'Builds reliable distributed systems.',
        phone: '+84 912 345 678',
        address: 'Ha Noi',
        githubUrl: ' HTTPS://GitHub.com:443/nguyenvanan ',
      },
    );
    const profile = expectSuccess(response);
    assert.equal(profile.fullName, 'Nguyen Van An');
    assert.equal(profile.completionPercent, 35);
    assert.equal(profile.githubUrl, 'https://github.com/nguyenvanan');
    assert.equal(profile.completionRuleVersion, 1);
    assert.equal(profile.completionWarning, true);
    assert.equal(profile.aggregateVersion, 1);
    assert.equal(profile.avatarFileId, null);
    assert.equal(profile.avatarUrl, null);
  });

  await t.test('five independent collection APIs reach 100 percent', async () => {
    let response = await api(
      'POST',
      '/educations',
      candidateToken,
      {
        school: 'Hanoi University of Science and Technology',
        major: 'Computer Science',
        degree: 'Engineer',
        startDate: '2018-09-01',
        endDate: '2023-06-30',
      },
    );
    let profile = expectSuccess(response, 201);
    educationId = profile.educations[0].id;
    assert.equal(profile.completionPercent, 50);

    response = await api(
      'POST',
      '/experiences',
      candidateToken,
      {
        companyName: 'Recruitment Co',
        position: 'Backend Engineer',
        startDate: '2023-07-01',
        isCurrent: true,
      },
    );
    profile = expectSuccess(response, 201);
    experienceId = profile.experiences[0].id;
    assert.equal(profile.completionPercent, 70);

    response = await api(
      'POST',
      '/skills',
      candidateToken,
      {
        name: 'TypeScript',
        level: 'Advanced',
      },
    );
    profile = expectSuccess(response, 201);
    skillId = profile.skills[0].id;
    assert.equal(profile.completionPercent, 90);

    response = await api(
      'POST',
      '/certificates',
      candidateToken,
      {
        name: 'Cloud Developer',
        issuer: 'Example Academy',
        issuedAt: '2025-01-15',
        credentialUrl:
          'https://example.com/certificates/cloud-developer',
      },
    );
    profile = expectSuccess(response, 201);
    certificateId = profile.certificates[0].id;
    assert.equal(profile.completionPercent, 95);

    response = await api(
      'POST',
      '/projects',
      candidateToken,
      {
        name: 'Recruitment Platform',
        role: 'Backend Engineer',
        description: 'Designed transactional profile writes.',
        url: 'https://example.com/projects/recruitment',
      },
    );
    profile = expectSuccess(response, 201);
    projectId = profile.projects[0].id;
    assert.equal(profile.completionPercent, 100);
    assert.equal(profile.completionWarning, false);
    assert.deepEqual(profile.missingSections, []);
    assert.equal(profile.aggregateVersion, 6);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(stored.completionPercent, 100);
    assert.equal(stored.completionRuleVersion, 1);
    assert.equal(stored.aggregateVersion, 6);
  });

  await t.test('GET is complete, deterministic and date-only safe', async () => {
    const response = await api(
      'GET',
      '/' + CANDIDATE_A,
      candidateToken,
    );
    const profile = expectSuccess(response);
    assert.equal(profile.educations[0].startDate, '2018-09-01');
    assert.equal(profile.educations[0].endDate, '2023-06-30');
    assert.equal(profile.experiences[0].startDate, '2023-07-01');
    assert.equal(profile.experiences[0].endDate, null);
    assert.equal(profile.skills[0].name, 'TypeScript');
  });

  await t.test('all five collection update APIs are owner-scoped', async () => {
    const updates = [
      [
        '/education/' + educationId,
        { school: 'HUST' },
        (profile) => profile.educations[0].school === 'HUST',
      ],
      [
        '/experience/' + experienceId,
        { position: 'Senior Backend Engineer' },
        (profile) =>
          profile.experiences[0].position ===
          'Senior Backend Engineer',
      ],
      [
        '/skill/' + skillId,
        { level: 'Expert' },
        (profile) => profile.skills[0].level === 'Expert',
      ],
      [
        '/certificate/' + certificateId,
        { issuer: 'Example Cloud Academy' },
        (profile) =>
          profile.certificates[0].issuer ===
          'Example Cloud Academy',
      ],
      [
        '/project/' + projectId,
        { role: 'Technical Lead' },
        (profile) =>
          profile.projects[0].role === 'Technical Lead',
      ],
    ];

    for (const [path, body, verify] of updates) {
      const response = await api(
        'PUT',
        path,
        candidateToken,
        body,
      );
      const profile = expectSuccess(response);
      assert.equal(verify(profile), true, path);
      assert.equal(profile.completionPercent, 100);
    }

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(stored.aggregateVersion, 11);
  });

  await t.test('invalid and duplicate blocks roll back aggregate metadata', async () => {
    const before = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });

    const duplicateSkill = await api(
      'POST',
      '/skills',
      candidateToken,
      { name: '  typescript  ' },
    );
    assert.equal(duplicateSkill.status, 409);
    assert.equal(duplicateSkill.body.code, 'SKILL_ALREADY_EXISTS');

    const invalidRange = await api(
      'PUT',
      '/educations/' + educationId,
      candidateToken,
      {
        startDate: '2025-01-01',
        endDate: '2024-01-01',
      },
    );
    assert.equal(invalidRange.status, 400);

    const missingPastEnd = await api(
      'POST',
      '/experiences',
      candidateToken,
      {
        companyName: 'Past Company',
        position: 'Engineer',
        startDate: '2020-01-01',
        isCurrent: false,
      },
    );
    assert.equal(missingPastEnd.status, 400);

    const nullRequiredField = await api(
      'PUT',
      '/projects/' + projectId,
      candidateToken,
      { name: null },
    );
    assert.equal(nullRequiredField.status, 400);

    const afterFailedWrites = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(
      afterFailedWrites.aggregateVersion,
      before.aggregateVersion,
    );
    assert.equal(afterFailedWrites.completionPercent, 100);
  });

  await t.test('child identifiers cannot cross profile ownership', async () => {
    const tokenB = accessToken(CANDIDATE_B);
    expectSuccess(
      await api(
        'PUT',
        '/' + CANDIDATE_B,
        tokenB,
        { fullName: 'Candidate B' },
      ),
    );

    const privateBlocks = [
      {
        name: 'education',
        path: 'educations',
        collection: 'educations',
        create: {
          school: 'Private School',
          startDate: '2020-01-01',
        },
        update: { school: 'Stolen School' },
      },
      {
        name: 'experience',
        path: 'experiences',
        collection: 'experiences',
        create: {
          companyName: 'Private Company',
          position: 'Engineer',
          startDate: '2022-01-01',
          isCurrent: true,
        },
        update: { position: 'Stolen Position' },
      },
      {
        name: 'skill',
        path: 'skills',
        collection: 'skills',
        create: { name: 'Private Skill' },
        update: { level: 'Stolen Level' },
      },
      {
        name: 'certificate',
        path: 'certificates',
        collection: 'certificates',
        create: {
          name: 'Private Certificate',
          issuer: 'Private Issuer',
          issuedAt: '2024-01-01',
        },
        update: { issuer: 'Stolen Issuer' },
      },
      {
        name: 'project',
        path: 'projects',
        collection: 'projects',
        create: { name: 'Private Project' },
        update: { role: 'Stolen Role' },
      },
    ];

    for (const block of privateBlocks) {
      const profile = expectSuccess(
        await api('POST', '/' + block.path, tokenB, block.create),
        201,
      );
      block.id = profile[block.collection][0].id;
    }

    for (const block of privateBlocks) {
      const crossOwnerUpdate = await api(
        'PUT',
        '/' + block.path + '/' + block.id,
        candidateToken,
        block.update,
      );
      assert.equal(
        crossOwnerUpdate.status,
        404,
        block.name + ' update must hide cross-owner IDs',
      );

      const crossOwnerDelete = await api(
        'DELETE',
        '/' + block.path + '/' + block.id,
        candidateToken,
      );
      assert.equal(
        crossOwnerDelete.status,
        404,
        block.name + ' delete must hide cross-owner IDs',
      );
    }

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_B },
      include: {
        educations: true,
        experiences: true,
        skills: true,
        certificates: true,
        projects: true,
      },
    });
    for (const block of privateBlocks) {
      assert.equal(stored[block.collection].length, 1, block.name);
    }
    assert.equal(stored.educations[0].school, 'Private School');
    assert.equal(stored.experiences[0].position, 'Engineer');
    assert.equal(stored.skills[0].name, 'Private Skill');
    assert.equal(stored.certificates[0].issuer, 'Private Issuer');
    assert.equal(stored.projects[0].name, 'Private Project');
  });

  await t.test('all delete APIs recalculate the score and clearing null works', async () => {
    const deletions = [
      ['/educations/' + educationId, 85],
      ['/experiences/' + experienceId, 65],
      ['/skills/' + skillId, 45],
      ['/certificates/' + certificateId, 40],
      ['/projects/' + projectId, 35],
    ];

    let profile;
    for (const [path, expectedPercent] of deletions) {
      profile = expectSuccess(
        await api('DELETE', path, candidateToken),
      );
      assert.equal(profile.completionPercent, expectedPercent, path);
    }
    assert.equal(profile.aggregateVersion, 16);

    profile = expectSuccess(
      await api(
        'PUT',
        '/' + CANDIDATE_A,
        candidateToken,
        { githubUrl: null },
      ),
    );
    assert.equal(profile.completionPercent, 30);
    assert.equal(profile.aggregateVersion, 17);
    assert.equal(profile.githubUrl, null);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: CANDIDATE_A },
    });
    assert.equal(stored.completionPercent, 30);
    assert.equal(stored.completionRuleVersion, 1);
    assert.equal(stored.aggregateVersion, 17);
  });

  await t.test('concurrent first writes preserve both blocks and version', async () => {
    const subjects = [
      CANDIDATE_C,
      ...Array.from({ length: 11 }, () => randomUUID()),
    ];

    for (const [index, subject] of subjects.entries()) {
      const token = accessToken(subject);
      const [education, skill] = await Promise.all([
        api('POST', '/educations', token, {
          school: 'Concurrent School ' + index,
          startDate: '2021-01-01',
        }),
        api('POST', '/skills', token, {
          name: 'PostgreSQL ' + index,
        }),
      ]);
      assert.equal(
        education.status,
        201,
        JSON.stringify(education.body),
      );
      assert.equal(skill.status, 201, JSON.stringify(skill.body));

      const profile = expectSuccess(
        await api('GET', '/' + subject, token),
      );
      assert.equal(profile.educations.length, 1);
      assert.equal(profile.skills.length, 1);
      assert.equal(profile.completionPercent, 35);
      assert.equal(profile.aggregateVersion, 2);

      const stored = await prisma.profile.findUniqueOrThrow({
        where: { userId: subject },
      });
      assert.equal(stored.completionPercent, 35);
      assert.equal(stored.aggregateVersion, 2);
    }
  });

  await t.test('concurrent writes to an existing profile do not lose updates', async () => {
    const subject = randomUUID();
    const token = accessToken(subject);
    const initial = expectSuccess(
      await api('PUT', '/' + subject, token, {
        headline: 'Platform Engineer',
      }),
    );
    assert.equal(initial.aggregateVersion, 1);

    const [general, skill] = await Promise.all([
      api('PUT', '/' + subject, token, {
        summary: 'Builds reliable platforms.',
      }),
      api('POST', '/skills', token, { name: 'Concurrency' }),
    ]);
    assert.equal(general.status, 200, JSON.stringify(general.body));
    assert.equal(skill.status, 201, JSON.stringify(skill.body));
    assert.deepEqual(
      [
        general.body.data.aggregateVersion,
        skill.body.data.aggregateVersion,
      ].sort((left, right) => left - right),
      [2, 3],
    );

    const profile = expectSuccess(
      await api('GET', '/' + subject.toUpperCase(), token),
    );
    assert.equal(profile.headline, 'Platform Engineer');
    assert.equal(profile.summary, 'Builds reliable platforms.');
    assert.equal(profile.skills.length, 1);
    assert.equal(profile.completionPercent, 30);
    assert.equal(profile.aggregateVersion, 3);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: subject },
    });
    assert.equal(stored.completionPercent, 30);
    assert.equal(stored.aggregateVersion, 3);
  });
  await t.test('six concurrent writers succeed with monotonic versions', async () => {
    const subject = randomUUID();
    const token = accessToken(subject);
    const initial = expectSuccess(
      await api('PUT', '/' + subject, token, {
        headline: 'Burst-safe Engineer',
      }),
    );
    assert.equal(initial.aggregateVersion, 1);

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        api('POST', '/skills', token, {
          name: 'Burst Skill ' + index,
        }),
      ),
    );
    for (const response of responses) {
      assert.equal(response.status, 201, JSON.stringify(response.body));
    }
    assert.deepEqual(
      responses
        .map((response) => response.body.data.aggregateVersion)
        .sort((left, right) => left - right),
      [2, 3, 4, 5, 6, 7],
    );

    const profile = expectSuccess(
      await api('GET', '/' + subject, token),
    );
    assert.equal(profile.skills.length, 6);
    assert.equal(profile.completionPercent, 25);
    assert.equal(profile.aggregateVersion, 7);
  });

  await t.test('per-profile collection cap rejects unbounded skill rows', async () => {
    const subject = randomUUID();
    const token = accessToken(subject);
    const limit = PROFILE_COLLECTION_LIMITS.skill;
    await prisma.profile.create({
      data: {
        userId: subject,
        completionPercent: 20,
        completionRuleVersion: 1,
        skills: {
          create: Array.from({ length: limit }, (_, index) => ({
            name: 'Bounded Skill ' + index,
            normalizedName: 'bounded skill ' + index,
          })),
        },
      },
    });

    const response = await api('POST', '/skills', token, {
      name: 'One Skill Too Many',
    });
    assert.equal(response.status, 409);
    assert.equal(
      response.body.code,
      'PROFILE_COLLECTION_LIMIT_REACHED',
    );
    assert.deepEqual(response.body.details, {
      collection: 'skill',
      limit,
    });
    assert.equal(
      await prisma.skill.count({
        where: { profile: { userId: subject } },
      }),
      limit,
    );
  });

  await t.test('concurrent normalized duplicate skills create one row', async () => {
    const tokenD = accessToken(CANDIDATE_D);
    const results = await Promise.all([
      api('POST', '/skills', tokenD, { name: 'NestJS' }),
      api('POST', '/skills', tokenD, { name: ' nestjs ' }),
    ]);
    assert.deepEqual(
      results.map((result) => result.status).sort(),
      [201, 409],
    );
    const conflict = results.find((result) => result.status === 409);
    assert.equal(conflict.body.code, 'SKILL_ALREADY_EXISTS');

    const profile = expectSuccess(
      await api('GET', '/' + CANDIDATE_D, tokenD),
    );
    assert.equal(profile.skills.length, 1);
    assert.equal(profile.completionPercent, 20);
    assert.equal(profile.aggregateVersion, 1);
  });

  await t.test('Unicode skill names follow the PostgreSQL normalization invariant', async () => {
    const subject = randomUUID();
    const token = accessToken(subject);
    const profile = expectSuccess(
      await api('POST', '/skills', token, {
        name: 'İSTANBUL',
      }),
      201,
    );
    assert.equal(profile.skills.length, 1);

    const stored = await prisma.skill.findFirstOrThrow({
      where: { profile: { userId: subject } },
    });
    const expected = await prisma.$queryRaw`
      SELECT LOWER(BTRIM(${stored.name})) AS "normalizedName"
    `;
    assert.equal(
      stored.normalizedName,
      expected[0].normalizedName,
    );

    const updated = expectSuccess(
      await api('PUT', '/skills/' + stored.id, token, {
        name: 'İZMİR',
      }),
    );
    assert.equal(updated.skills[0].name, 'İZMİR');
  });
});
