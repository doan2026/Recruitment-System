'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Prisma } = require('@prisma/client');
const {
  InternalCvV2Service,
} = require('../dist/profile/internal-cv-v2.service');

const CANDIDATE_ID = '10000000-0000-4000-8000-000000000061';
const CV_ID = '20000000-0000-4000-8000-000000000061';
const FILE_ID = '30000000-0000-4000-8000-000000000061';
const CREATED_AT = new Date('2026-08-27T01:00:00.000Z');
const UPDATED_AT = new Date('2026-08-27T01:01:00.000Z');

const cv = () => ({
  id: CV_ID,
  userId: CANDIDATE_ID,
  title: 'Backend CV',
  type: 'UPLOAD',
  fileId: FILE_ID,
  fileUrl: null,
  mediaReferenceId: '40000000-0000-4000-8000-000000000061',
  templateId: null,
  contentJson: null,
  contentSchemaVersion: null,
  revisionSeriesId: null,
  revisionNumber: null,
  previousRevisionId: null,
  aggregateVersion: 4,
  isDefault: true,
  isDeleted: false,
  firstUsedAt: null,
  deletedAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
});

test('v2 verifies CV and reads a bounded ordered skill snapshot at Repeatable Read', async () => {
  let profileQuery;
  let isolationLevel;
  const transaction = {
    cv: { findFirst: async () => cv() },
    profile: {
      findUnique: async (query) => {
        profileQuery = query;
        return {
          aggregateVersion: 8,
          skills: [{ name: 'PostgreSQL' }, { name: 'NestJS' }],
        };
      },
    },
  };
  const prisma = {
    $transaction: async (work, options) => {
      isolationLevel = options.isolationLevel;
      return work(transaction);
    },
  };

  const result = await new InternalCvV2Service(prisma).verifyCandidateCv(
    CANDIDATE_ID.toUpperCase(),
    { candidateId: CANDIDATE_ID.toUpperCase(), cvId: CV_ID.toUpperCase() },
  );

  assert.equal(
    isolationLevel,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  );
  assert.deepEqual(profileQuery, {
    where: { userId: CANDIDATE_ID },
    select: {
      aggregateVersion: true,
      skills: {
        select: { name: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 101,
      },
    },
  });
  assert.deepEqual(result.profileSkillSnapshot, {
    schemaVersion: 1,
    profileAggregateVersion: 8,
    skills: ['PostgreSQL', 'NestJS'],
  });
  assert.equal(result.available, true);
  assert.equal(result.cv.cvId, CV_ID);
});

test('v2 hides the entire skill snapshot when the CV is unavailable', async () => {
  let profileRead = false;
  const prisma = {
    $transaction: async (work) => work({
      cv: { findFirst: async () => null },
      profile: {
        findUnique: async () => {
          profileRead = true;
          return { aggregateVersion: 1, skills: [] };
        },
      },
    }),
  };

  const result = await new InternalCvV2Service(prisma).verifyCandidateCv(
    CANDIDATE_ID,
    { candidateId: CANDIDATE_ID, cvId: CV_ID },
  );

  assert.deepEqual(result, {
    candidateId: CANDIDATE_ID,
    cvId: CV_ID,
    available: false,
    cv: null,
    profileSkillSnapshot: null,
  });
  assert.equal(profileRead, false);
});

test('v2 fails closed rather than truncating a corrupted over-limit skill set', async () => {
  const prisma = {
    $transaction: async (work) => work({
      cv: { findFirst: async () => cv() },
      profile: {
        findUnique: async () => ({
          aggregateVersion: 9,
          skills: Array.from(
            { length: 101 },
            (_, index) => ({ name: `Skill ${index}` }),
          ),
        }),
      },
    }),
  };

  await assert.rejects(
    () => new InternalCvV2Service(prisma).verifyCandidateCv(
      CANDIDATE_ID,
      { candidateId: CANDIDATE_ID, cvId: CV_ID },
    ),
    (error) =>
      error.getStatus() === 503 &&
      error.getResponse().code === 'PROFILE_SKILL_SNAPSHOT_INVALID',
  );
});

test('v2 rejects a mismatched Candidate before reading persistence', async () => {
  let transactionStarted = false;
  const prisma = {
    $transaction: async () => {
      transactionStarted = true;
    },
  };

  await assert.rejects(
    () => new InternalCvV2Service(prisma).verifyCandidateCv(
      '10000000-0000-4000-8000-000000000099',
      { candidateId: CANDIDATE_ID, cvId: CV_ID },
    ),
    (error) =>
      error.getStatus() === 403 &&
      error.getResponse().code === 'PROFILE_OWNER_REQUIRED',
  );
  assert.equal(transactionStarted, false);
});
