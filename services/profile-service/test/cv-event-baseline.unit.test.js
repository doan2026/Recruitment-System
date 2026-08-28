'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CvEventAction, CvType } = require('@prisma/client');
const {
  parseCvEventBaselineArguments,
} = require('../dist/cv-event-baseline');
const {
  CvEventBaselineService,
} = require('../dist/profile/cv-event-baseline.service');

const CV_ID = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_REFERENCE_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = new Date('2026-08-20T01:00:00.000Z');

const candidate = {
  cvId: CV_ID,
  userId: CANDIDATE_ID,
  fileId: FILE_ID,
  createdAt: CREATED_AT,
};

const cv = {
  id: CV_ID,
  userId: CANDIDATE_ID,
  title: 'Must never appear in CLI output',
  type: CvType.UPLOAD,
  fileId: FILE_ID,
  fileUrl: null,
  mediaReferenceId: MEDIA_REFERENCE_ID,
  templateId: null,
  contentJson: null,
  contentSchemaVersion: null,
  revisionSeriesId: CV_ID,
  revisionNumber: 1,
  previousRevisionId: null,
  aggregateVersion: 7,
  isDefault: true,
  isDeleted: false,
  firstUsedAt: null,
  deletedAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const sequencedPrisma = (queryResults, transaction) => {
  const results = [...queryResults];
  return {
    queryCount: 0,
    transactionCount: 0,
    async $queryRaw() {
      this.queryCount += 1;
      assert.ok(results.length > 0, 'unexpected baseline query');
      return results.shift();
    },
    async $transaction(operation, options) {
      this.transactionCount += 1;
      assert.equal(options.isolationLevel, 'Serializable');
      return operation(transaction);
    },
  };
};

test('dry-run verifies bounded private candidates without opening a transaction or exposing rows', async () => {
  const prisma = sequencedPrisma(
    [[{ count: 2n }], [candidate], [{ count: 1n }]],
    undefined,
  );
  const verifies = [];
  const service = new CvEventBaselineService(
    prisma,
    {
      verifyUserFile: async (...arguments_) => verifies.push(arguments_),
    },
    {
      append: async () => assert.fail('dry-run must not append'),
      wake: () => assert.fail('dry-run must not wake the publisher'),
    },
  );

  const summary = await service.run({
    execute: false,
    batchSize: 25,
    maxBatches: 1,
  });

  assert.deepEqual(verifies, [[FILE_ID, CANDIDATE_ID, 'CV']]);
  assert.equal(prisma.transactionCount, 0);
  assert.deepEqual(summary, {
    activeLegacyCvCount: 2,
    batchesProcessed: 1,
    candidatesScanned: 1,
    mediaVerified: 1,
    mediaErrors: 0,
    eventsAppended: 0,
    concurrentlyCovered: 0,
    stateChanged: 0,
    eligibleRemaining: 1,
  });
  assert.equal(JSON.stringify(summary).includes(CV_ID), false);
  assert.equal(JSON.stringify(summary).includes(cv.title), false);
});

test('execute verifies Media before a Serializable Profile-then-CV lock and appends current version without mutation', async () => {
  const lockOrder = [];
  const transaction = {
    async $queryRaw(request) {
      const sql = request.strings.join('');
      if (sql.includes('FROM "profile"."profiles"')) {
        lockOrder.push('PROFILE');
        return [{ id: '55555555-5555-4555-8555-555555555555' }];
      }
      if (sql.includes('FROM "profile"."cvs"')) {
        lockOrder.push('CV');
        return [{ id: CV_ID }];
      }
      assert.fail('unexpected transaction query');
    },
    cv: {
      findUnique: async () => cv,
      count: async () => 0,
      update: async () => assert.fail('baseline must not update CV'),
    },
    profile: {
      update: async () => assert.fail('baseline must not bump Profile'),
    },
    cvDeletionWorkflow: {
      findUnique: async () => null,
    },
    cvEventOutbox: {
      findFirst: async () => null,
    },
  };
  const prisma = sequencedPrisma(
    [[{ count: 0n }], [candidate], [{ count: 0n }]],
    transaction,
  );
  const calls = [];
  let mediaVerified = false;
  let wakes = 0;
  const service = new CvEventBaselineService(
    prisma,
    {
      verifyUserFile: async () => {
        mediaVerified = true;
      },
    },
    {
      append: async (tx, snapshot, action) => {
        assert.equal(mediaVerified, true);
        assert.equal(tx, transaction);
        calls.push([snapshot.id, snapshot.aggregateVersion, action]);
      },
      wake: () => {
        wakes += 1;
      },
    },
  );

  const summary = await service.run({
    execute: true,
    batchSize: 25,
    maxBatches: 1,
  });

  assert.deepEqual(lockOrder, ['PROFILE', 'CV']);
  assert.deepEqual(calls, [[CV_ID, 7, CvEventAction.UPSERTED]]);
  assert.equal(cv.aggregateVersion, 7);
  assert.equal(wakes, 1);
  assert.equal(prisma.transactionCount, 1);
  assert.equal(summary.eventsAppended, 1);
  assert.equal(summary.eligibleRemaining, 0);
});

test('Media failure leaves the candidate eligible and never starts a database transaction', async () => {
  const prisma = sequencedPrisma(
    [[{ count: 0n }], [candidate], [{ count: 1n }]],
    undefined,
  );
  const service = new CvEventBaselineService(
    prisma,
    {
      verifyUserFile: async () => {
        throw new Error('private provider detail must not escape');
      },
    },
    {
      append: async () => assert.fail('invalid Media must not append'),
      wake: () => assert.fail('invalid Media must not wake'),
    },
  );

  const summary = await service.run({
    execute: true,
    batchSize: 25,
    maxBatches: 1,
  });

  assert.equal(prisma.transactionCount, 0);
  assert.equal(summary.mediaErrors, 1);
  assert.equal(summary.eventsAppended, 0);
  assert.equal(summary.eligibleRemaining, 1);
  assert.equal(JSON.stringify(summary).includes('provider'), false);
});

test('a concurrent runner that already appended any CV event is reported as covered', async () => {
  const transaction = {
    async $queryRaw(request) {
      return request.strings.join('').includes('"profiles"')
        ? [{ id: '55555555-5555-4555-8555-555555555555' }]
        : [{ id: CV_ID }];
    },
    cv: {
      findUnique: async () => cv,
      count: async () => 0,
    },
    cvDeletionWorkflow: { findUnique: async () => null },
    cvEventOutbox: {
      findFirst: async () => ({ id: '66666666-6666-4666-8666-666666666666' }),
    },
  };
  const prisma = sequencedPrisma(
    [[{ count: 0n }], [candidate], [{ count: 0n }]],
    transaction,
  );
  const service = new CvEventBaselineService(
    prisma,
    { verifyUserFile: async () => undefined },
    {
      append: async () => assert.fail('covered CV must not append'),
      wake: () => assert.fail('covered CV must not wake'),
    },
  );

  const summary = await service.run({
    execute: true,
    batchSize: 25,
    maxBatches: 1,
  });
  assert.equal(summary.concurrentlyCovered, 1);
  assert.equal(summary.eventsAppended, 0);
});

test('CLI arguments are dry-run by default and execution is double-confirmed with bounded work', () => {
  assert.deepEqual(parseCvEventBaselineArguments([]), {
    execute: false,
    batchSize: 25,
    maxBatches: 1,
  });
  assert.deepEqual(
    parseCvEventBaselineArguments([
      '--execute',
      '--confirm',
      'CV_EVENTS_BASELINE_V1',
      '--batch-size',
      '100',
      '--max-batches',
      '2',
    ]),
    { execute: true, batchSize: 100, maxBatches: 2 },
  );
  assert.throws(
    () => parseCvEventBaselineArguments(['--execute']),
    /confirmation/,
  );
  assert.throws(
    () => parseCvEventBaselineArguments(['--batch-size', '101']),
    /allowed range/,
  );
  assert.throws(
    () => parseCvEventBaselineArguments(['--max-batches', '0']),
    /allowed range/,
  );
  assert.throws(
    () => parseCvEventBaselineArguments(['--execute', '--execute']),
    /Duplicate/,
  );
  assert.throws(
    () => parseCvEventBaselineArguments(['--unknown']),
    /Unknown/,
  );
});
