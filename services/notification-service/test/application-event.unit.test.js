'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NotificationType } = require('@prisma/client');
const {
  EventValidationError,
  parseApplicationEvent,
} = require('../dist/events/application-event');
const {
  mapApplicationNotification,
} = require('../dist/events/application-notification.mapper');

const APPLICATION_ID = '10000000-0000-4000-8000-000000000001';
const JOB_ID = '20000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '30000000-0000-4000-8000-000000000001';
const RECRUITER_ID = '40000000-0000-4000-8000-000000000001';
const EVENT_ID = '50000000-0000-4000-8000-000000000001';

const event = (overrides = {}) => ({
  schema_version: 1,
  aggregate_version: 1,
  event_id: EVENT_ID,
  action: 'STATUS_CHANGED',
  application_id: APPLICATION_ID,
  job_id: JOB_ID,
  job_title: 'Platform Engineer',
  candidate_id: CANDIDATE_ID,
  recruiter_id: RECRUITER_ID,
  actor_id: RECRUITER_ID,
  from_status: 'APPLIED',
  to_status: 'REVIEWING',
  occurred_at: '2026-08-28T12:30:00.123Z',
  ...overrides,
});

const parse = (payload = event(), key = APPLICATION_ID, max = 65536) =>
  parseApplicationEvent(
    Buffer.from(key),
    Buffer.from(JSON.stringify(payload)),
    max,
  );

test('parses the strict application event v1 contract', () => {
  const parsed = parse();
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.aggregateVersion, 1);
  assert.equal(parsed.actorId, RECRUITER_ID);
  assert.equal(parsed.occurredAt.toISOString(), '2026-08-28T12:30:00.123Z');
});

test('dual-reads the bounded legacy event during rollout', () => {
  const payload = event();
  delete payload.schema_version;
  delete payload.aggregate_version;
  delete payload.actor_id;
  const parsed = parse(payload);
  assert.equal(parsed.schemaVersion, null);
  assert.equal(parsed.aggregateVersion, null);
  assert.equal(parsed.actorId, null);
});

[
  ['EVENT_KEY_MISMATCH', event(), JOB_ID],
  ['EVENT_SCHEMA_UNSUPPORTED', event({ schema_version: 2 })],
  ['EVENT_AGGREGATE_VERSION_MISSING', event({ aggregate_version: undefined })],
  ['EVENT_ACTOR_ID_INVALID', event({ actor_id: 'not-a-uuid' })],
  ['EVENT_FROM_STATUS_INVALID', event({ from_status: 'UNKNOWN' })],
  ['EVENT_OCCURRED_AT_INVALID', event({ occurred_at: '2026-08-28 12:30' })],
  ['EVENT_FIELD_UNKNOWN', event({ salary: 100000000 })],
  [
    'EVENT_OFFER_FIELDS_INVALID',
    event({
      action: 'OFFER_SENT',
      from_status: 'REVIEWING',
      to_status: 'OFFER',
      offer_id: '60000000-0000-4000-8000-000000000001',
      offer_status: 'SENT',
      offer_version: 1,
    }),
  ],
  [
    'EVENT_OFFER_FIELDS_INVALID',
    event({
      from_status: 'REVIEWING',
      to_status: 'HIRED',
      offer_id: '60000000-0000-4000-8000-000000000001',
      offer_status: 'ACCEPTED',
      offer_version: 1,
    }),
  ],
  [
    'EVENT_OFFER_FIELDS_INVALID',
    event({
      from_status: 'OFFER',
      to_status: 'REJECTED',
      offer_id: '60000000-0000-4000-8000-000000000001',
      offer_status: 'ACCEPTED',
      offer_version: 1,
    }),
  ],
  [
    'EVENT_OFFER_FIELDS_INVALID',
    event({ offer_id: null, offer_status: null, offer_version: null }),
  ],
].forEach(([code, payload, key]) => {
  test(`rejects invalid event contract: ${code}`, () => {
    assert.throws(
      () => parse(payload, key),
      (error) => error instanceof EventValidationError && error.code === code,
    );
  });
});

test('rejects oversized payload before JSON parsing', () => {
  assert.throws(
    () => parse(event({ job_title: 'x'.repeat(300) }), APPLICATION_ID, 64),
    (error) =>
      error instanceof EventValidationError &&
      error.code === 'EVENT_PAYLOAD_TOO_LARGE',
  );
});

test('maps an initial application to the recruiter without raw payload data', () => {
  const mapped = mapApplicationNotification(
    parse(
      event({
        aggregate_version: 0,
        actor_id: CANDIDATE_ID,
        from_status: null,
        to_status: 'APPLIED',
      }),
    ),
  );
  assert.equal(mapped.userId, RECRUITER_ID);
  assert.equal(mapped.type, NotificationType.APPLICATION_RECEIVED);
  assert.deepEqual(Object.keys(mapped.payloadJson).sort(), [
    'applicationId',
    'deepLink',
    'jobId',
    'toStatus',
  ]);
});

test('maps recruiter pipeline changes to the candidate', () => {
  const mapped = mapApplicationNotification(parse());
  assert.equal(mapped.userId, CANDIDATE_ID);
  assert.equal(mapped.type, NotificationType.APPLICATION_STATUS_CHANGED);
});

test('maps a candidate offer response to the recruiter', () => {
  const mapped = mapApplicationNotification(
    parse(
      event({
        actor_id: CANDIDATE_ID,
        from_status: 'OFFER',
        to_status: 'HIRED',
        offer_id: '60000000-0000-4000-8000-000000000001',
        offer_status: 'ACCEPTED',
        offer_version: 1,
      }),
    ),
  );
  assert.equal(mapped.userId, RECRUITER_ID);
  assert.equal(mapped.type, NotificationType.OFFER_ACCEPTED);
});

test('maps a sent offer to the candidate', () => {
  const mapped = mapApplicationNotification(
    parse(
      event({
        action: 'OFFER_SENT',
        from_status: 'INTERVIEW',
        to_status: 'OFFER',
        offer_id: '60000000-0000-4000-8000-000000000001',
        offer_status: 'SENT',
        offer_version: 0,
      }),
    ),
  );
  assert.equal(mapped.userId, CANDIDATE_ID);
  assert.equal(mapped.type, NotificationType.OFFER_RECEIVED);
});

test('maps a declined offer to the recruiter', () => {
  const mapped = mapApplicationNotification(
    parse(
      event({
        actor_id: CANDIDATE_ID,
        from_status: 'OFFER',
        to_status: 'REJECTED',
        offer_id: '60000000-0000-4000-8000-000000000001',
        offer_status: 'DECLINED',
        offer_version: 1,
      }),
    ),
  );
  assert.equal(mapped.userId, RECRUITER_ID);
  assert.equal(mapped.type, NotificationType.OFFER_DECLINED);
});

test('maps a legacy withdrawal to the recruiter when actor is absent', () => {
  const payload = event({
    from_status: 'INTERVIEW',
    to_status: 'WITHDRAWN',
  });
  delete payload.schema_version;
  delete payload.aggregate_version;
  delete payload.actor_id;
  const mapped = mapApplicationNotification(parse(payload));
  assert.equal(mapped.userId, RECRUITER_ID);
  assert.equal(mapped.type, NotificationType.APPLICATION_STATUS_CHANGED);
});
