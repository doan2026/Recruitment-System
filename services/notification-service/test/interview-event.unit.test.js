'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NotificationType } = require('@prisma/client');
const {
  EventValidationError,
} = require('../dist/events/event-processing');
const {
  parseInterviewEvent,
} = require('../dist/events/interview-event');
const {
  mapInterviewNotifications,
} = require('../dist/events/interview-notification.mapper');

const INTERVIEW_ID = '10000000-0000-4000-8000-000000000001';
const APPLICATION_ID = '20000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '30000000-0000-4000-8000-000000000001';
const INTERVIEWER_ID = '40000000-0000-4000-8000-000000000001';
const EVENT_ID = '50000000-0000-4000-8000-000000000001';

const event = (overrides = {}) => ({
  schema_version: 1,
  event_id: EVENT_ID,
  action: 'SCHEDULED',
  interview_id: INTERVIEW_ID,
  application_id: APPLICATION_ID,
  candidate_id: CANDIDATE_ID,
  interviewer_id: INTERVIEWER_ID,
  actor_id: INTERVIEWER_ID,
  round_number: 2,
  schedule_revision: 1,
  scheduled_start_at: '2026-09-10T02:00:00.000Z',
  scheduled_end_at: '2026-09-10T02:45:00.000Z',
  status: 'SCHEDULED',
  aggregate_version: 0,
  occurred_at: '2026-08-28T14:30:00.123Z',
  ...overrides,
});

const parse = (payload = event(), key = INTERVIEW_ID, max = 65536) =>
  parseInterviewEvent(
    Buffer.from(key),
    Buffer.from(JSON.stringify(payload)),
    max,
  );

test('parses the exact interview scheduled v1 contract', () => {
  const parsed = parse();
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.eventId, EVENT_ID);
  assert.equal(parsed.interviewId, INTERVIEW_ID);
  assert.equal(parsed.actorId, parsed.interviewerId);
  assert.equal(parsed.roundNumber, 2);
  assert.equal(parsed.scheduleRevision, 1);
  assert.equal(
    parsed.scheduledStartAt.toISOString(),
    '2026-09-10T02:00:00.000Z',
  );
});

[
  ['EVENT_SCHEMA_INVALID', event({ schema_version: 2 })],
  ['EVENT_ACTION_STATUS_INVALID', event({ action: 'CONFIRMED' })],
  ['EVENT_ACTION_STATUS_INVALID', event({ status: 'CONFIRMED' })],
  ['EVENT_KEY_MISMATCH', event(), APPLICATION_ID],
  [
    'EVENT_ACTOR_INTERVIEWER_MISMATCH',
    event({ actor_id: CANDIDATE_ID }),
  ],
  [
    'EVENT_PARTICIPANTS_INVALID',
    event({ candidate_id: INTERVIEWER_ID }),
  ],
  [
    'EVENT_ID_INVALID',
    event({ event_id: '50000000-0000-1000-8000-000000000001' }),
  ],
  ['EVENT_ROUND_INVALID', event({ round_number: 0 })],
  ['EVENT_ROUND_INVALID', event({ round_number: 21 })],
  ['EVENT_SCHEDULE_REVISION_INVALID', event({ schedule_revision: 0 })],
  [
    'EVENT_AGGREGATE_VERSION_INVALID',
    event({ aggregate_version: Number.MAX_SAFE_INTEGER + 1 }),
  ],
  [
    'EVENT_SCHEDULED_START_INVALID',
    event({ scheduled_start_at: '2026-09-10T09:00:00+07:00' }),
  ],
  [
    'EVENT_SCHEDULE_RANGE_INVALID',
    event({ scheduled_end_at: '2026-09-10T02:00:00.000Z' }),
  ],
  [
    'EVENT_OCCURRED_AT_INVALID',
    event({ occurred_at: '2026-08-28 14:30:00' }),
  ],
  [
    'EVENT_OCCURRED_AT_INVALID',
    event({ occurred_at: '2026-08-28T14:30:00Z' }),
  ],
  [
    'EVENT_OCCURRED_AT_INVALID',
    event({ occurred_at: '2026-02-31T14:30:00.000Z' }),
  ],
  ['EVENT_FIELD_SET_INVALID', event({ room_url: 'https://jitsi/secret' })],
  ['EVENT_FIELD_SET_INVALID', event({ token: 'secret' })],
  ['EVENT_FIELD_SET_INVALID', event({ location: 'Private room' })],
  ['EVENT_FIELD_SET_INVALID', event({ notes: 'Confidential note' })],
].forEach(([code, payload, key]) => {
  test(`rejects invalid or sensitive interview event: ${code}`, () => {
    assert.throws(
      () => parse(payload, key),
      (error) => error instanceof EventValidationError && error.code === code,
    );
  });
});

test('rejects an incomplete field set and oversized payload before parsing', () => {
  const missing = event();
  delete missing.schedule_revision;
  assert.throws(
    () => parse(missing),
    (error) =>
      error instanceof EventValidationError &&
      error.code === 'EVENT_FIELD_SET_INVALID',
  );
  assert.throws(
    () => parse(event(), INTERVIEW_ID, 64),
    (error) =>
      error instanceof EventValidationError &&
      error.code === 'EVENT_PAYLOAD_TOO_LARGE',
  );
});

test('maps only the candidate with a minimal private payload', () => {
  const [draft] = mapInterviewNotifications(parse());
  assert.equal(draft.userId, CANDIDATE_ID);
  assert.equal(draft.type, NotificationType.INTERVIEW_SCHEDULED);
  assert.deepEqual(Object.keys(draft.payloadJson).sort(), [
    'action',
    'applicationId',
    'deepLink',
    'interviewId',
    'roundNumber',
    'scheduleRevision',
    'scheduledEnd',
    'scheduledStart',
  ]);
  const serialized = JSON.stringify(draft);
  for (const sensitive of [
    'room_url',
    'token',
    'location',
    'notes',
    'Private room',
    'Confidential note',
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});
