'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  Prisma,
  RecruiterDiscoveryState,
} = require('@prisma/client');
const {
  PutRecruiterDiscoveryDto,
  RecruiterDiscoveryResolveRequestDto,
  RecruiterDiscoverySnapshotRequestDto,
} = require('../dist/profile/dto/recruiter-discovery.dto');
const {
  RecruiterDiscoveryService,
} = require('../dist/profile/recruiter-discovery.service');

const CANDIDATE_A = '10000000-0000-4000-8000-0000000000a1';
const CANDIDATE_B = '10000000-0000-4000-8000-0000000000b1';
const CV_A = '20000000-0000-4000-8000-0000000000a1';
const CV_B = '20000000-0000-4000-8000-0000000000b1';
const PURPOSE = 'RECRUITER_JOB_RECOMMENDATION';

const expected = (overrides = {}) => ({
  candidateId: CANDIDATE_A,
  cvId: CV_A,
  discoveryVersion: 3,
  profileVersion: 7,
  ...overrides,
});

test('recruiter discovery DTOs enforce the closed v1 consent and internal request shapes', async () => {
  const enabled = plainToInstance(PutRecruiterDiscoveryDto, {
    expectedVersion: 0,
    state: 'ENABLED',
    purpose: PURPOSE,
    consentVersion: 1,
    cvId: CV_A.toUpperCase(),
  });
  assert.deepEqual(await validate(enabled), []);
  assert.equal(enabled.cvId, CV_A);

  const disabled = plainToInstance(PutRecruiterDiscoveryDto, {
    expectedVersion: 1,
    state: 'DISABLED',
    purpose: PURPOSE,
    consentVersion: null,
    cvId: null,
  });
  assert.deepEqual(await validate(disabled), []);

  const snapshot = plainToInstance(RecruiterDiscoverySnapshotRequestDto, {
    schemaVersion: 1,
    purpose: PURPOSE,
  });
  assert.deepEqual(await validate(snapshot), []);
  assert.ok((await validate(plainToInstance(
    RecruiterDiscoverySnapshotRequestDto,
    { schemaVersion: 2, purpose: PURPOSE },
  ))).length > 0);

  const duplicate = plainToInstance(RecruiterDiscoveryResolveRequestDto, {
    schemaVersion: 1,
    purpose: PURPOSE,
    candidates: [expected(), expected({ cvId: CV_B })],
  });
  assert.ok((await validate(duplicate)).length > 0);

  const oversized = plainToInstance(RecruiterDiscoveryResolveRequestDto, {
    schemaVersion: 1,
    purpose: PURPOSE,
    candidates: Array.from({ length: 51 }, (_, index) => ({
      candidateId:
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      cvId:
        `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      discoveryVersion: 1,
      profileVersion: 1,
    })),
  });
  assert.ok((await validate(oversized)).length > 0);
});

test('service rejects inconsistent consent and resolver expectations without touching persistence', async () => {
  const service = new RecruiterDiscoveryService({});
  const invalidConsents = [
    {
      expectedVersion: 0,
      state: RecruiterDiscoveryState.ENABLED,
      purpose: PURPOSE,
      consentVersion: null,
      cvId: CV_A,
    },
    {
      expectedVersion: 0,
      state: RecruiterDiscoveryState.DISABLED,
      purpose: PURPOSE,
      consentVersion: 1,
      cvId: CV_A,
    },
    {
      expectedVersion: 0,
      state: RecruiterDiscoveryState.ENABLED,
      purpose: 'ANOTHER_PURPOSE',
      consentVersion: 1,
      cvId: CV_A,
    },
  ];
  for (const input of invalidConsents) {
    await assert.rejects(
      () => service.replace(CANDIDATE_A, input),
      (error) =>
        error.getStatus() === 400 &&
        error.getResponse().code === 'RECRUITER_DISCOVERY_INVALID',
    );
  }

  const invalidResolutions = [
    { schemaVersion: 2, purpose: PURPOSE, candidates: [expected()] },
    { schemaVersion: 1, purpose: PURPOSE, candidates: [] },
    {
      schemaVersion: 1,
      purpose: PURPOSE,
      candidates: [expected(), expected({ cvId: CV_B })],
    },
    {
      schemaVersion: 1,
      purpose: PURPOSE,
      candidates: [expected({ discoveryVersion: 0 })],
    },
  ];
  for (const request of invalidResolutions) {
    await assert.rejects(
      () => service.resolve(request),
      (error) =>
        error.getStatus() === 400 &&
        error.getResponse().code ===
          'RECRUITER_DISCOVERY_EXPECTATION_INVALID',
    );
  }
});

test('snapshot is deterministic, minimal and fails closed instead of truncating past 500', async () => {
  const validRows = [
    {
      candidateId: CANDIDATE_A.toUpperCase(),
      cvId: CV_A.toUpperCase(),
      discoveryVersion: 3,
      profileVersion: 7,
      fullName: 'Candidate A',
    },
  ];
  const transactionOptions = [];
  const service = new RecruiterDiscoveryService({
    $transaction: async (operation, options) => {
      transactionOptions.push(options);
      return operation({ $queryRaw: async () => validRows });
    },
  });
  assert.deepEqual(await service.snapshot(), {
    schemaVersion: 1,
    purpose: PURPOSE,
    candidates: [{
      candidateId: CANDIDATE_A,
      cvId: CV_A,
      discoveryVersion: 3,
      profileVersion: 7,
    }],
  });
  assert.equal(
    transactionOptions[0].isolationLevel,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  );

  const overLimit = new RecruiterDiscoveryService({
    $transaction: async (operation) => operation({
      $queryRaw: async () => Array.from({ length: 501 }, () => validRows[0]),
    }),
  });
  await assert.rejects(
    () => overLimit.snapshot(),
    (error) =>
      error.getStatus() === 503 &&
      error.getResponse().code ===
        'RECRUITER_DISCOVERY_SNAPSHOT_LIMIT_EXCEEDED',
  );
});

test('resolver preserves requested order and omits stale or unsafe projections', async () => {
  const discoveries = [
    {
      candidateId: CANDIDATE_A,
      state: RecruiterDiscoveryState.ENABLED,
      consentVersion: 1,
      cvId: CV_A,
      version: 3,
    },
    {
      candidateId: CANDIDATE_B,
      state: RecruiterDiscoveryState.ENABLED,
      consentVersion: 1,
      cvId: CV_B,
      version: 4,
    },
  ];
  const profiles = [
    {
      userId: CANDIDATE_A,
      aggregateVersion: 7,
      fullName: '  Candidate\u00a0A  ',
      headline: ' Platform   Engineer ',
      skills: [{ name: 'TypeScript' }, { name: 'PostgreSQL' }],
    },
    {
      userId: CANDIDATE_B,
      aggregateVersion: 8,
      fullName: 'Candidate B',
      headline: null,
      skills: [{ name: 'Node.js' }, { name: 'NODE.JS' }],
    },
  ];
  const cvs = [
    { id: CV_A, userId: CANDIDATE_A },
    { id: CV_B, userId: CANDIDATE_B },
  ];
  const service = new RecruiterDiscoveryService({
    $transaction: async (operation, options) => {
      assert.equal(
        options.isolationLevel,
        Prisma.TransactionIsolationLevel.RepeatableRead,
      );
      return operation({
        candidateRecruiterDiscovery: {
          findMany: async () => discoveries,
        },
        profile: { findMany: async () => profiles },
        cv: { findMany: async () => cvs },
      });
    },
  });

  const result = await service.resolve({
    schemaVersion: 1,
    purpose: PURPOSE,
    candidates: [
      expected({
        candidateId: CANDIDATE_B,
        cvId: CV_B,
        discoveryVersion: 4,
        profileVersion: 8,
      }),
      expected(),
    ],
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    purpose: PURPOSE,
    candidates: [{
      candidateId: CANDIDATE_A,
      fullName: 'Candidate A',
      headline: 'Platform Engineer',
      skills: ['TypeScript', 'PostgreSQL'],
    }],
  });
  assert.deepEqual(Object.keys(result.candidates[0]).sort(), [
    'candidateId',
    'fullName',
    'headline',
    'skills',
  ]);

  discoveries[0].version = 4;
  const stale = await service.resolve({
    schemaVersion: 1,
    purpose: PURPOSE,
    candidates: [expected()],
  });
  assert.deepEqual(stale.candidates, []);
});
