'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CvEventAction, CvType } = require('@prisma/client');
const {
  buildCvEvent,
  CV_EVENT_PAYLOAD_FIELDS,
} = require('../dist/profile/cv-event');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CV_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';

const persistedCv = (overrides = {}) => ({
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
  aggregateVersion: 7,
  isDefault: true,
  isDeleted: false,
  firstUsedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-08-28T01:00:00.000Z'),
  updatedAt: new Date('2026-08-28T01:00:00.000Z'),
  ...overrides,
});

test('cv-events v1 is an exact frozen privacy-minimized Media contract', () => {
  const payload = buildCvEvent(
    persistedCv(),
    CvEventAction.UPSERTED,
    EVENT_ID,
    new Date('2026-08-28T02:03:04.005Z'),
  );

  assert.deepEqual(Object.keys(payload), [...CV_EVENT_PAYLOAD_FIELDS]);
  assert.deepEqual(payload, {
    event_id: EVENT_ID,
    action: 'UPSERTED',
    cv_id: CV_ID,
    candidate_id: CANDIDATE_ID,
    file_id: FILE_ID,
    cv_type: 'UPLOAD',
    occurred_at: '2026-08-28T02:03:04.005Z',
    schema_version: 1,
    aggregate_version: 7,
  });
  assert.equal(Object.isFrozen(payload), true);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    'file_url',
    'media_reference_id',
    'content_json',
    'title',
    'phone',
    'email',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('deactivation and hard tombstone require a soft-deleted snapshot', () => {
  const deleted = persistedCv({
    type: CvType.ONLINE,
    isDefault: false,
    isDeleted: true,
    deletedAt: new Date('2026-08-28T02:00:00.000Z'),
  });
  assert.equal(
    buildCvEvent(deleted, CvEventAction.DEACTIVATED, EVENT_ID).action,
    'DEACTIVATED',
  );
  assert.equal(
    buildCvEvent(deleted, CvEventAction.DELETED, EVENT_ID).action,
    'DELETED',
  );
  assert.throws(
    () => buildCvEvent(deleted, CvEventAction.UPSERTED, EVENT_ID),
    /incompatible with deletion state/,
  );
  assert.throws(
    () => buildCvEvent(persistedCv(), CvEventAction.DELETED, EVENT_ID),
    /incompatible with deletion state/,
  );
});

test('builder rejects legacy, invalid version, and invalid occurrence inputs', () => {
  assert.throws(
    () => buildCvEvent(
      persistedCv({
        fileUrl: 'https://legacy.example/cv.pdf',
        mediaReferenceId: null,
      }),
      CvEventAction.UPSERTED,
      EVENT_ID,
    ),
    /private Media-backed CV/,
  );
  for (const aggregateVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => buildCvEvent(
        persistedCv({ aggregateVersion }),
        CvEventAction.UPSERTED,
        EVENT_ID,
      ),
      /positive integer/,
    );
  }
  assert.throws(
    () => buildCvEvent(
      persistedCv(),
      CvEventAction.UPSERTED,
      EVENT_ID,
      new Date('invalid'),
    ),
    /occurrence time/,
  );
});
