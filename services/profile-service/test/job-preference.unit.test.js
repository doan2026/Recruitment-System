'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  JobPreferenceState,
  PreferredJobType,
  Prisma,
} = require('@prisma/client');
const {
  PutJobPreferenceDto,
} = require('../dist/profile/dto/job-preference.dto');
const {
  JobPreferenceService,
} = require('../dist/profile/job-preference.service');

const CANDIDATE_ID = '10000000-0000-4000-8000-000000000081';

const enabledInput = (overrides = {}) => ({
  expectedVersion: 0,
  state: JobPreferenceState.ENABLED,
  consentVersion: 1,
  targetRoles: [' Backend   Engineer '],
  preferredLocations: [' Ha\u00a0Noi '],
  preferredJobTypes: [PreferredJobType.FULL_TIME],
  minimumSalary: '20000000',
  ...overrides,
});

const disabledInput = (expectedVersion) => ({
  expectedVersion,
  state: JobPreferenceState.DISABLED,
  consentVersion: null,
  targetRoles: [],
  preferredLocations: [],
  preferredJobTypes: [],
  minimumSalary: null,
});

test('job preference DTO canonicalizes explicit values and rejects unsafe or duplicate input', async () => {
  const valid = plainToInstance(PutJobPreferenceDto, enabledInput());
  assert.deepEqual(await validate(valid), []);
  assert.deepEqual(valid.targetRoles, ['Backend Engineer']);
  assert.deepEqual(valid.preferredLocations, ['Ha Noi']);
  assert.deepEqual(
    await validate(
      plainToInstance(PutJobPreferenceDto, disabledInput(1)),
    ),
    [],
  );

  const invalidInputs = [
    enabledInput({ targetRoles: ['Node.js', 'NODE.JS'] }),
    enabledInput({ targetRoles: ['Backend\u0000Engineer'] }),
    enabledInput({ targetRoles: ['100% Engineer'] }),
    enabledInput({ preferredLocations: ['Ha_Noi'] }),
    enabledInput({ targetRoles: ['Path\\Role'] }),
    enabledInput({ targetRoles: ['\ud800'] }),
    enabledInput({ targetRoles: [42] }),
    enabledInput({ targetRoles: Array.from({ length: 11 }, (_, i) => `Role ${i}`) }),
    enabledInput({ preferredLocations: [''] }),
    enabledInput({ preferredJobTypes: ['CONTRACT'] }),
    enabledInput({ minimumSalary: 20_000_000 }),
    enabledInput({ minimumSalary: '01.00' }),
  ];
  for (const input of invalidInputs) {
    const errors = await validate(
      plainToInstance(PutJobPreferenceDto, input),
    );
    assert.ok(errors.length > 0, JSON.stringify(input));
  }
});

test('service exposes virtual UNSET and preserves consent transition timestamps under CAS', async () => {
  let profileExists = false;
  let preference = null;
  const transactionOptions = [];
  const times = [
    new Date('2026-08-28T01:00:00.000Z'),
    new Date('2026-08-28T01:01:00.000Z'),
    new Date('2026-08-28T01:02:00.000Z'),
    new Date('2026-08-28T01:03:00.000Z'),
    new Date('2026-08-28T01:04:00.000Z'),
  ];

  const transaction = {
    $queryRaw: async (strings) => {
      const sql = strings.join(' ');
      if (sql.includes('FROM "profile"."profiles"')) {
        return profileExists ? [{ id: 'profile-id' }] : [];
      }
      if (sql.includes('candidate_job_preferences')) {
        return preference
          ? [{
            state: preference.state,
            version: preference.version,
            consentedAt: preference.consentedAt,
            withdrawnAt: preference.withdrawnAt,
          }]
          : [];
      }
      if (sql.includes('CLOCK_TIMESTAMP')) {
        return [{ now: times.shift() }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    profile: {
      create: async () => {
        profileExists = true;
        return { id: 'profile-id' };
      },
    },
    candidateJobPreference: {
      findUnique: async () => preference,
      create: async ({ data }) => {
        preference = { ...data };
        return preference;
      },
      update: async ({ data }) => {
        preference = {
          ...preference,
          ...data,
          version: preference.version + data.version.increment,
        };
        return preference;
      },
    },
  };
  const prisma = {
    $transaction: async (operation, options) => {
      transactionOptions.push(options);
      return operation(transaction);
    },
  };
  const service = new JobPreferenceService(prisma);

  const unset = await service.get(CANDIDATE_ID.toUpperCase());
  assert.deepEqual(unset, {
    schemaVersion: 1,
    candidateId: CANDIDATE_ID,
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
    transactionOptions[0].isolationLevel,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  );

  const first = await service.replace(CANDIDATE_ID, enabledInput());
  assert.equal(first.version, 1);
  assert.equal(first.minimumSalary, '20000000.00');
  assert.equal(first.consentedAt, '2026-08-28T01:00:00.000Z');
  assert.equal(first.withdrawnAt, null);

  const edited = await service.replace(CANDIDATE_ID, enabledInput({
    expectedVersion: 1,
    targetRoles: ['Platform Engineer'],
  }));
  assert.equal(edited.version, 2);
  assert.equal(edited.consentedAt, first.consentedAt);
  assert.equal(edited.updatedAt, '2026-08-28T01:01:00.000Z');

  const disabled = await service.replace(CANDIDATE_ID, disabledInput(2));
  assert.equal(disabled.version, 3);
  assert.equal(disabled.consentedAt, first.consentedAt);
  assert.equal(disabled.withdrawnAt, '2026-08-28T01:02:00.000Z');
  assert.deepEqual(disabled.targetRoles, []);

  const disabledAgain = await service.replace(
    CANDIDATE_ID,
    disabledInput(3),
  );
  assert.equal(disabledAgain.version, 4);
  assert.equal(disabledAgain.withdrawnAt, disabled.withdrawnAt);

  const reenabled = await service.replace(CANDIDATE_ID, enabledInput({
    expectedVersion: 4,
    targetRoles: ['Data Engineer'],
    minimumSalary: null,
  }));
  assert.equal(reenabled.version, 5);
  assert.equal(reenabled.consentedAt, '2026-08-28T01:04:00.000Z');
  assert.equal(reenabled.withdrawnAt, null);

  await assert.rejects(
    () => service.replace(CANDIDATE_ID, enabledInput()),
    (error) =>
      error.getStatus() === 409 &&
      error.getResponse().code === 'JOB_PREFERENCE_VERSION_CONFLICT' &&
      error.getResponse().details.actualVersion === 5,
  );
});

test('service enforces consent and salary invariants even without HTTP validation', async () => {
  const service = new JobPreferenceService({});
  const invalidInputs = [
    enabledInput({
      targetRoles: [],
      preferredLocations: [],
      preferredJobTypes: [],
      minimumSalary: null,
    }),
    enabledInput({ minimumSalary: '0' }),
    enabledInput({ minimumSalary: '10000000000000.00' }),
    enabledInput({ consentVersion: null }),
    enabledInput({ targetRoles: ['NestJS', 'NESTJS'] }),
    enabledInput({ targetRoles: ['100% Engineer'] }),
    enabledInput({ preferredLocations: ['Ha_Noi'] }),
    enabledInput({ targetRoles: ['Path\\Role'] }),
    enabledInput({ targetRoles: ['\ud800'] }),
    enabledInput({ preferredJobTypes: ['CONTRACT'] }),
    {
      ...disabledInput(0),
      targetRoles: ['Do not retain this value'],
    },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(
      () => service.replace(CANDIDATE_ID, input),
      (error) =>
        error.getStatus() === 400 &&
        error.getResponse().code === 'JOB_PREFERENCE_INVALID',
    );
  }
});
