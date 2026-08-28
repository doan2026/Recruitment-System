'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, beforeEach, test } = require('node:test');
const { CvType, PrismaClient } = require('@prisma/client');
const {
  CvEventBaselineService,
} = require('../dist/profile/cv-event-baseline.service');
const {
  CvEventPublisherService,
} = require('../dist/profile/cv-event-publisher.service');
const {
  assertSafeTestDatabase,
} = require('./test-database-safety');

const prisma = new PrismaClient();
let canResetSchema = false;

const publisherConfig = {
  get: (name) => ({
    CV_EVENT_PUBLISHER_ENABLED: 'false',
    KAFKA_BROKERS: 'kafka:9092',
    KAFKA_CV_TOPIC: 'cv-events-baseline-integration',
    CV_EVENT_OUTBOX_BATCH_SIZE: '10',
    CV_EVENT_OUTBOX_RETRY_BASE_MS: '100',
    CV_EVENT_OUTBOX_RETRY_MAX_MS: '1000',
  })[name],
};

const reset = async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."cv_event_outbox", "profile"."profiles" CASCADE',
  );
};

const createCv = async ({ legacy = false, aggregateVersion = 1 } = {}) => {
  const userId = randomUUID();
  const cvId = randomUUID();
  const fileId = randomUUID();
  await prisma.profile.create({
    data: {
      userId,
      cvs: {
        create: {
          id: cvId,
          title: legacy ? 'Legacy URL must remain private' : 'Baseline CV',
          type: CvType.UPLOAD,
          fileId,
          fileUrl: legacy ? 'https://legacy.invalid/private-cv.pdf' : null,
          mediaReferenceId: legacy ? null : randomUUID(),
          aggregateVersion,
          isDefault: true,
        },
      },
    },
  });
  return { userId, cvId, fileId };
};

const baseline = (media, publisher) =>
  new CvEventBaselineService(prisma, media, publisher);

before(async () => {
  await assertSafeTestDatabase(prisma);
  canResetSchema = true;
  await reset();
});

beforeEach(async () => {
  await reset();
});

after(async () => {
  try {
    if (canResetSchema) await reset();
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline dry-run preflights only active Media-backed CVs and execute is repeatable', async () => {
  const eligible = await createCv({ aggregateVersion: 4 });
  await createCv({ legacy: true });
  const covered = await createCv({ aggregateVersion: 1 });
  const publisher = new CvEventPublisherService(prisma, publisherConfig);
  const coveredCv = await prisma.cv.findUniqueOrThrow({
    where: { id: covered.cvId },
  });
  await prisma.$transaction((transaction) =>
    publisher.append(transaction, coveredCv, 'UPSERTED'),
  );
  await prisma.$transaction([
    prisma.cv.update({
      where: { id: covered.cvId },
      data: {
        title: 'Renamed without a new PDF event',
        aggregateVersion: { increment: 1 },
      },
    }),
    prisma.profile.update({
      where: { userId: covered.userId },
      data: { aggregateVersion: { increment: 1 } },
    }),
  ]);

  const verified = [];
  const service = baseline(
    {
      verifyUserFile: async (fileId, userId, type) => {
        verified.push([fileId, userId, type]);
      },
    },
    publisher,
  );
  const dryRun = await service.run({
    execute: false,
    batchSize: 25,
    maxBatches: 1,
  });
  assert.deepEqual(verified, [[eligible.fileId, eligible.userId, 'CV']]);
  assert.equal(dryRun.activeLegacyCvCount, 1);
  assert.equal(dryRun.candidatesScanned, 1);
  assert.equal(dryRun.eventsAppended, 0);
  assert.equal(dryRun.eligibleRemaining, 1);
  assert.equal(await prisma.cvEventOutbox.count(), 1);
  assert.equal(
    (await prisma.cv.findUniqueOrThrow({ where: { id: covered.cvId } }))
      .aggregateVersion,
    2,
  );
  assert.deepEqual(
    (
      await prisma.cvEventOutbox.findMany({
        where: { cvId: covered.cvId },
        select: { aggregateVersion: true },
      })
    ).map((event) => event.aggregateVersion),
    [1],
  );

  const executed = await service.run({
    execute: true,
    batchSize: 25,
    maxBatches: 1,
  });
  assert.equal(executed.eventsAppended, 1);
  assert.equal(executed.eligibleRemaining, 0);

  const event = await prisma.cvEventOutbox.findFirstOrThrow({
    where: { cvId: eligible.cvId },
  });
  const persistedCv = await prisma.cv.findUniqueOrThrow({
    where: { id: eligible.cvId },
  });
  assert.equal(event.aggregateVersion, 4);
  assert.equal(persistedCv.aggregateVersion, 4);
  assert.deepEqual(Object.keys(event.payload).sort(), [
    'action',
    'aggregate_version',
    'candidate_id',
    'cv_id',
    'cv_type',
    'event_id',
    'file_id',
    'occurred_at',
    'schema_version',
  ]);
  assert.equal(JSON.stringify(event.payload).includes('legacy.invalid'), false);
  assert.equal(JSON.stringify(event.payload).includes('Baseline CV'), false);

  const callsBeforeRetry = verified.length;
  const retry = await service.run({
    execute: true,
    batchSize: 25,
    maxBatches: 1,
  });
  assert.equal(retry.candidatesScanned, 0);
  assert.equal(retry.eventsAppended, 0);
  assert.equal(verified.length, callsBeforeRetry);
  assert.equal(await prisma.cvEventOutbox.count(), 2);
  await publisher.onModuleDestroy();
});

test('Media preflight failure appends nothing and remains visible for a later run', async () => {
  await createCv();
  const publisher = new CvEventPublisherService(prisma, publisherConfig);
  const service = baseline(
    {
      verifyUserFile: async () => {
        throw new Error('upstream private detail');
      },
    },
    publisher,
  );
  const summary = await service.run({
    execute: true,
    batchSize: 25,
    maxBatches: 1,
  });
  assert.equal(summary.mediaErrors, 1);
  assert.equal(summary.eventsAppended, 0);
  assert.equal(summary.eligibleRemaining, 1);
  assert.equal(await prisma.cvEventOutbox.count(), 0);
  assert.equal(JSON.stringify(summary).includes('upstream'), false);
  await publisher.onModuleDestroy();
});

test('two runners preflight the same CV but commit only one baseline event', async () => {
  const source = await createCv({ aggregateVersion: 3 });
  const publisher = new CvEventPublisherService(prisma, publisherConfig);
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const media = {
    verifyUserFile: async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
    },
  };
  const first = baseline(media, publisher);
  const second = baseline(media, publisher);

  const summaries = await Promise.all([
    first.run({ execute: true, batchSize: 25, maxBatches: 1 }),
    second.run({ execute: true, batchSize: 25, maxBatches: 1 }),
  ]);

  assert.equal(arrivals, 2);
  assert.equal(
    summaries.reduce((total, value) => total + value.eventsAppended, 0),
    1,
  );
  assert.equal(
    summaries.reduce((total, value) => total + value.concurrentlyCovered, 0),
    1,
  );
  assert.equal(
    await prisma.cvEventOutbox.count({ where: { cvId: source.cvId } }),
    1,
  );
  assert.equal(
    (await prisma.cv.findUniqueOrThrow({ where: { id: source.cvId } }))
      .aggregateVersion,
    3,
  );
  await publisher.onModuleDestroy();
});

test('state is re-read after preflight and an inactive CV is never published', async () => {
  const source = await createCv();
  const publisher = new CvEventPublisherService(prisma, publisherConfig);
  const service = baseline(
    {
      verifyUserFile: async () => {
        await prisma.cv.update({
          where: { id: source.cvId },
          data: {
            isDeleted: true,
            isDefault: false,
            deletedAt: new Date(),
            aggregateVersion: { increment: 1 },
          },
        });
      },
    },
    publisher,
  );
  const summary = await service.run({
    execute: true,
    batchSize: 25,
    maxBatches: 1,
  });
  assert.equal(summary.stateChanged, 1);
  assert.equal(summary.eventsAppended, 0);
  assert.equal(summary.eligibleRemaining, 0);
  assert.equal(await prisma.cvEventOutbox.count(), 0);
  await publisher.onModuleDestroy();
});
