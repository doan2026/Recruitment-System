'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  CvEventAction,
  CvType,
} = require('@prisma/client');
const {
  CvEventPublisherService,
} = require('../dist/profile/cv-event-publisher.service');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CV_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';

const config = (overrides = {}) => {
  const values = {
    CV_EVENT_PUBLISHER_ENABLED: 'true',
    KAFKA_BROKERS: 'kafka:9092',
    KAFKA_CV_TOPIC: 'cv-events-test',
    CV_EVENT_OUTBOX_BATCH_SIZE: '10',
    CV_EVENT_OUTBOX_RETRY_BASE_MS: '100',
    CV_EVENT_OUTBOX_RETRY_MAX_MS: '1000',
    ...overrides,
  };
  return { get: (key) => values[key] };
};

const cv = (overrides = {}) => ({
  id: CV_ID,
  userId: CANDIDATE_ID,
  title: 'Backend CV',
  type: CvType.UPLOAD,
  fileId: FILE_ID,
  fileUrl: null,
  mediaReferenceId: '55555555-5555-4555-8555-555555555555',
  templateId: null,
  contentJson: null,
  contentSchemaVersion: null,
  revisionSeriesId: null,
  revisionNumber: null,
  previousRevisionId: null,
  aggregateVersion: 2,
  isDefault: true,
  isDeleted: false,
  firstUsedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-08-28T01:00:00.000Z'),
  updatedAt: new Date('2026-08-28T01:00:00.000Z'),
  ...overrides,
});

const payload = {
  event_id: EVENT_ID,
  action: 'UPSERTED',
  cv_id: CV_ID,
  candidate_id: CANDIDATE_ID,
  file_id: FILE_ID,
  cv_type: 'UPLOAD',
  occurred_at: '2026-08-28T02:00:00.000Z',
  schema_version: 1,
  aggregate_version: 2,
};

const persistedEvent = (overrides = {}) => ({
  id: EVENT_ID,
  cvId: CV_ID,
  candidateId: CANDIDATE_ID,
  fileId: FILE_ID,
  cvType: CvType.UPLOAD,
  aggregateVersion: 2,
  action: CvEventAction.UPSERTED,
  topic: 'cv-events-test',
  eventKey: CV_ID,
  payload,
  attempts: 1,
  nextAttemptAt: new Date('2026-08-28T02:00:00.000Z'),
  leaseOwner: 'worker',
  leaseFence: 1,
  leaseExpiresAt: new Date('2026-08-28T02:01:00.000Z'),
  publishedAt: null,
  lastErrorCode: null,
  createdAt: new Date('2026-08-28T02:00:00.000Z'),
  ...overrides,
});

test('append persists exact immutable snapshot through the caller transaction even when dispatch is disabled', async () => {
  const creates = [];
  const service = new CvEventPublisherService(
    {},
    config({ CV_EVENT_PUBLISHER_ENABLED: 'false' }),
  );
  const transaction = {
    cvEventOutbox: {
      create: async (request) => creates.push(request),
    },
  };

  const eventId = await service.append(
    transaction,
    cv(),
    CvEventAction.UPSERTED,
  );

  assert.match(
    eventId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(creates.length, 1);
  assert.deepEqual(
    {
      ...creates[0].data,
      id: '<event>',
      createdAt: '<time>',
      nextAttemptAt: '<time>',
      payload: {
        ...creates[0].data.payload,
        event_id: '<event>',
        occurred_at: '<time>',
      },
    },
    {
      id: '<event>',
      cvId: CV_ID,
      candidateId: CANDIDATE_ID,
      fileId: FILE_ID,
      cvType: CvType.UPLOAD,
      aggregateVersion: 2,
      action: CvEventAction.UPSERTED,
      topic: 'cv-events-test',
      eventKey: CV_ID,
      payload: {
        event_id: '<event>',
        action: 'UPSERTED',
        cv_id: CV_ID,
        candidate_id: CANDIDATE_ID,
        file_id: FILE_ID,
        cv_type: 'UPLOAD',
        occurred_at: '<time>',
        schema_version: 1,
        aggregate_version: 2,
      },
      nextAttemptAt: '<time>',
      createdAt: '<time>',
    },
  );
  assert.equal(creates[0].data.createdAt, creates[0].data.nextAttemptAt);
  assert.equal(
    creates[0].data.payload.occurred_at,
    creates[0].data.createdAt.toISOString(),
  );
  await assert.doesNotReject(() => service.onModuleDestroy());
});

test('publisher claims in aggregate order and sends persisted exact bytes under lease fence', async () => {
  let claimCount = 0;
  let claimSql = '';
  const updates = [];
  const sends = [];
  const prisma = {
    $queryRaw: async (strings) => {
      claimSql = strings.join('?');
      claimCount += 1;
      return claimCount === 1 ? [{ id: EVENT_ID }] : [];
    },
    cvEventOutbox: {
      findUnique: async () => persistedEvent(),
      updateMany: async (request) => {
        updates.push(request);
        return { count: 1 };
      },
    },
  };
  const service = new CvEventPublisherService(prisma, config());
  let disconnected = 0;
  service.producer = {
    connect: async () => undefined,
    send: async (request) => sends.push(request),
    disconnect: async () => {
      disconnected += 1;
    },
  };

  assert.equal(await service.flushPending(), 1);
  assert.match(claimSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(claimSql, /earlier\."aggregate_version"/);
  assert.match(claimSql, /earlier\."published_at" IS NULL/);
  assert.match(claimSql, /"lease_fence" = claimed\."lease_fence" \+ 1/);
  assert.deepEqual(sends, [{
    topic: 'cv-events-test',
    timeout: 3000,
    messages: [{ key: CV_ID, value: JSON.stringify(payload) }],
  }]);
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.equal(update.where.id, EVENT_ID);
    assert.equal(update.where.leaseFence, 1);
    assert.equal(update.where.publishedAt, null);
  }
  assert.ok(updates[1].data.publishedAt instanceof Date);
  assert.equal(updates[1].data.leaseOwner, null);
  await service.onModuleDestroy();
  assert.equal(disconnected, 1);
});

test('failed publish releases only the matching fence with redacted stable error code', async (t) => {
  let claimCount = 0;
  const updates = [];
  const prisma = {
    $queryRaw: async () => {
      claimCount += 1;
      return claimCount === 1 ? [{ id: EVENT_ID }] : [];
    },
    cvEventOutbox: {
      findUnique: async () => persistedEvent({ attempts: 3 }),
      updateMany: async (request) => {
        updates.push(request);
        return { count: 1 };
      },
    },
  };
  const service = new CvEventPublisherService(prisma, config());
  service.producer = {
    connect: async () => undefined,
    send: async () => {
      const error = new Error('PRIVATE candidate content');
      error.name = 'KafkaJSConnectionError';
      throw error;
    },
    disconnect: async () => undefined,
  };
  t.mock.method(Math, 'random', () => 0);

  assert.equal(await service.flushPending(), 0);
  const retry = updates.at(-1);
  assert.equal(retry.where.leaseFence, 1);
  assert.equal(retry.data.lastErrorCode, 'KAFKA_JSCONNECTION_ERROR');
  assert.equal(retry.data.leaseOwner, null);
  assert.equal(retry.data.leaseExpiresAt, null);
  assert.equal(JSON.stringify(retry).includes('PRIVATE'), false);
  await service.onModuleDestroy();
});

test('configuration fails closed and a disabled dispatcher never claims rows', async () => {
  assert.throws(
    () => new CvEventPublisherService(
      {},
      config({ CV_EVENT_PUBLISHER_ENABLED: 'yes' }),
    ),
    /must be true or false/,
  );
  assert.throws(
    () => new CvEventPublisherService({}, config({ KAFKA_CV_TOPIC: '..' })),
    /valid Kafka topic/,
  );
  assert.throws(
    () => new CvEventPublisherService(
      {},
      config({ CV_EVENT_OUTBOX_LEASE_MS: '1000' }),
    ),
    /must be at least/,
  );

  let claims = 0;
  const service = new CvEventPublisherService(
    { $queryRaw: async () => { claims += 1; return []; } },
    config({ CV_EVENT_PUBLISHER_ENABLED: 'false' }),
  );
  assert.equal(await service.flushPending(), 0);
  assert.equal(claims, 0);
  await service.onModuleDestroy();
});
