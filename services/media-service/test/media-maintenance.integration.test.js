'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  FileOwnerType,
  FileStatus,
  MediaCleanupEventType,
  MediaCleanupKind,
  MediaCleanupStatus,
  MediaType,
  PrismaClient,
  StorageDeliveryType,
  StorageResourceType,
} = require('@prisma/client');
const {
  MediaMaintenanceService,
} = require('../dist/media/media-maintenance.service');
const {
  MediaService,
} = require('../dist/media/media.service');
const { FakeStorageProvider } = require('./fake-storage-provider');
const {
  assertSafeTestDatabase,
} = require('./test-database-safety');

const OWNER_ID = '30000000-0000-4000-8000-000000000001';
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const options = {
  batchSize: 20,
  leaseMs: 2000,
  providerTimeoutMs: 500,
  retryBaseMs: 60 * 1000,
  retryMaxMs: 60 * 1000,
  providerGraceMs: 1,
  cleanIntervalMs: 60 * 1000,
  expiredRetentionMs: 1,
};

test('Media cleanup maintenance on PostgreSQL 16', async (t) => {
  const prisma = new PrismaClient();
  await prisma.$connect();
  await assertSafeTestDatabase(prisma);

  t.after(async () => {
    await prisma.$disconnect();
  });

  const resetDatabase = async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE ' +
        '"media"."media_cleanup_event", ' +
        '"media"."media_cleanup_job", ' +
        '"media"."media_maintenance_control", ' +
        '"media"."file_reference", ' +
        '"media"."file_meta" ' +
        'RESTART IDENTITY CASCADE',
    );
  };

  const databaseNow = async () => {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT clock_timestamp() AS "now"',
    );
    return rows[0].now;
  };

  const createFile = async (
    status,
    {
      withCanonical = false,
      createdAt,
      updatedAt,
    } = {},
  ) => {
    const now = await databaseNow();
    const created =
      createdAt ?? new Date(now.getTime() - TWO_DAYS_MS);
    const id = randomUUID();
    const canonical = withCanonical
      ? {
          assetId: 'asset-' + id,
          providerVersion: '1700000000',
          canonicalUrl:
            'https://res.cloudinary.com/test-cloud/image/upload/v1700000000/' +
            id,
          mimeType: 'image/png',
          format: 'png',
          bytes: 1024,
          width: 800,
          height: 600,
          etag: 'etag-' + id,
          confirmedAt: new Date(created.getTime() + 5 * 60 * 1000),
        }
      : {};
    return prisma.fileMeta.create({
      data: {
        id,
        requestedBy: OWNER_ID,
        ownerId: OWNER_ID,
        ownerType: FileOwnerType.USER,
        mediaType: MediaType.AVATAR,
        status,
        publicId: 'recruitment/avatar/' + id,
        folder: 'recruitment/avatar',
        originalFilename: id + '.png',
        expectedFormat: 'png',
        storageResourceType: StorageResourceType.IMAGE,
        storageDeliveryType: StorageDeliveryType.UPLOAD,
        uploadPreset: 'test_avatar_signed',
        signatureTimestamp:
          Math.floor(created.getTime() / 1000) - 3000,
        intentExpiresAt: new Date(
          created.getTime() + 10 * 60 * 1000,
        ),
        createdAt: created,
        updatedAt: updatedAt ?? created,
        deletedAt:
          status === FileStatus.DELETED
            ? new Date(now.getTime() - 60 * 60 * 1000)
            : undefined,
        ...canonical,
      },
    });
  };

  const createMaintenance = (workerId, storage) => {
    const media = new MediaService(
      prisma,
      storage,
      () => new Date(),
    );
    return new MediaMaintenanceService(
      prisma,
      storage,
      media,
      workerId,
    );
  };

  const makeRetriesDue = async () => {
    await prisma.mediaCleanupJob.updateMany({
      where: { status: MediaCleanupStatus.RETRY },
      data: { nextAttemptAt: new Date('2000-01-01T00:00:00.000Z') },
    });
  };

  await t.test(
    'database cycle lease elects one replica and uses fencing',
    async () => {
      await resetDatabase();
      const storage = new FakeStorageProvider();
      const workerA = createMaintenance('cleanup-worker-a', storage);
      const workerB = createMaintenance('cleanup-worker-b', storage);

      const acquisitions = await Promise.all([
        workerA.tryAcquireScheduledCycle(1000, 5000),
        workerB.tryAcquireScheduledCycle(1000, 5000),
      ]);
      assert.equal(
        acquisitions.filter((value) => value !== null).length,
        1,
      );
      const winner =
        acquisitions[0] === null ? workerB : workerA;
      const loser =
        acquisitions[0] === null ? workerA : workerB;
      const fence =
        acquisitions.find((value) => value !== null);

      assert.equal(
        await loser.renewScheduledCycle(fence, 5000),
        false,
      );
      assert.equal(
        await winner.renewScheduledCycle(fence, 5000),
        true,
      );
      assert.equal(
        await loser.completeScheduledCycle(fence, 1000),
        false,
      );
      assert.equal(
        await winner.completeScheduledCycle(fence, 1000),
        true,
      );

      await prisma.mediaMaintenanceControl.update({
        where: { name: 'media-cleanup' },
        data: {
          nextRunAt: new Date('2000-01-01T00:00:00.000Z'),
        },
      });
      const nextFence =
        await loser.tryAcquireScheduledCycle(1, 20);
      assert.equal(nextFence, fence + 1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(
        await loser.completeScheduledCycle(nextFence, 1000),
        false,
      );
      assert.equal(
        await winner.tryAcquireScheduledCycle(1, 5000),
        nextFence + 1,
      );
    },
  );

  await t.test(
    'lifecycle cleanup deletes exact orphans and reconciles siblings',
    async () => {
      await resetDatabase();
      const storage = new FakeStorageProvider();
      const maintenance = createMaintenance(
        'cleanup-lifecycle',
        storage,
      );

      const expired = await createFile(FileStatus.PENDING);
      const expiredAsset = storage.register(expired, {
        contextVisible: false,
      });

      const verifying = await createFile(FileStatus.VERIFYING);

      const rejected = await createFile(FileStatus.REJECTED);
      storage.register(rejected);

      const active = await createFile(FileStatus.ACTIVE, {
        withCanonical: true,
      });
      const activeAsset = storage.register(active);
      storage.register(active, {
        assetId: 'sibling-' + active.id,
        publicId: active.publicId + '-unexpected',
      });

      const deleteFailed = await createFile(
        FileStatus.DELETE_FAILED,
        { withCanonical: true },
      );
      storage.register(deleteFailed);

      const first = await maintenance.runOnce(options);
      assert.equal(first.expired, 1);
      assert.equal(first.confirmationLeasesRecovered, 1);
      assert.equal(first.jobsClaimed, 5);
      assert.equal(first.succeeded, 1);
      assert.equal(first.retried, 4);

      assert.equal(
        (
          await prisma.fileMeta.findUnique({
            where: { id: expired.id },
          })
        ).status,
        FileStatus.EXPIRED,
      );
      assert.equal(
        (
          await prisma.fileMeta.findUnique({
            where: { id: verifying.id },
          })
        ).status,
        FileStatus.EXPIRED,
      );
      assert.equal(
        storage.assets.has(storage.assetKey(expiredAsset)),
        false,
        'the exact known object must be deleted even when context lookup hides it',
      );
      assert.equal(
        storage.assets.has(storage.assetKey(activeAsset)),
        true,
      );
      assert.equal(
        [...storage.assets.values()].some(
          (asset) =>
            asset.contextFileId === active.id &&
            asset.publicId !== active.publicId,
        ),
        false,
      );
      assert.equal(
        (
          await prisma.fileMeta.findUnique({
            where: { id: deleteFailed.id },
          })
        ).status,
        FileStatus.DELETED,
      );
      assert.equal(
        storage.deleteOptions.some(
          (value) => value.timeoutMs === options.providerTimeoutMs,
        ),
        true,
      );

      await makeRetriesDue();
      await maintenance.runOnce(options);
      await makeRetriesDue();
      await maintenance.runOnce(options);

      const jobs = await prisma.mediaCleanupJob.findMany({
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(jobs.length, 6);
      assert.equal(
        jobs.every(
          (job) => job.status === MediaCleanupStatus.SUCCEEDED,
        ),
        true,
      );
      assert.equal(
        jobs.find(
          (job) =>
            job.fileId === active.id &&
            job.kind === MediaCleanupKind.SIBLING_SWEEP,
        ).cleanPasses,
        2,
      );
      assert.equal(
        await prisma.mediaCleanupEvent.count({
          where: {
            eventType: MediaCleanupEventType.SUCCEEDED,
          },
        }),
        6,
      );

      const terminalJob = jobs[0];
      await assert.rejects(() =>
        prisma.mediaCleanupJob.update({
          where: { id: terminalJob.id },
          data: { lastErrorCode: 'TAMPERED' },
        }),
      );
      const event = await prisma.mediaCleanupEvent.findFirstOrThrow();
      await assert.rejects(() =>
        prisma.mediaCleanupEvent.update({
          where: { id: event.id },
          data: { errorCode: 'TAMPERED' },
        }),
      );
      await assert.rejects(() =>
        prisma.mediaCleanupEvent.delete({
          where: { id: event.id },
        }),
      );
    },
  );

  await t.test(
    'provider outage retries with capped backoff until recovery',
    async () => {
      await resetDatabase();
      const storage = new FakeStorageProvider();
      const maintenance = createMaintenance(
        'cleanup-retry',
        storage,
      );
      const rejected = await createFile(FileStatus.REJECTED);
      const rejectedAsset = storage.register(rejected);
      storage.failDelete = true;

      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await makeRetriesDue();
        const result = await maintenance.runOnce(options);
        assert.equal(result.retried, 1);
      }
      let job = await prisma.mediaCleanupJob.findFirstOrThrow({
        where: { fileId: rejected.id },
      });
      assert.equal(job.status, MediaCleanupStatus.RETRY);
      assert.equal(job.attemptCount, 4);
      assert.equal(job.lastErrorCode, 'STORAGE_UNAVAILABLE');

      storage.failDelete = false;
      await makeRetriesDue();
      await maintenance.runOnce(options);
      await makeRetriesDue();
      await maintenance.runOnce(options);
      await makeRetriesDue();
      await maintenance.runOnce(options);

      job = await prisma.mediaCleanupJob.findFirstOrThrow({
        where: { fileId: rejected.id },
      });
      assert.equal(job.status, MediaCleanupStatus.SUCCEEDED);
      assert.equal(job.cleanPasses, 2);
      assert.equal(
        storage.assets.has(storage.assetKey(rejectedAsset)),
        false,
      );
    },
  );

  await t.test(
    'urgent file deletion is claimed before an older sibling sweep backlog',
    async () => {
      await resetDatabase();
      const storage = new FakeStorageProvider();
      const maintenance = createMaintenance(
        'cleanup-priority',
        storage,
      );

      for (let index = 0; index < 3; index += 1) {
        const active = await createFile(FileStatus.ACTIVE, {
          withCanonical: true,
        });
        storage.register(active);
        await prisma.mediaCleanupJob.create({
          data: {
            fileId: active.id,
            kind: MediaCleanupKind.SIBLING_SWEEP,
            nextAttemptAt: new Date('1990-01-01T00:00:00.000Z'),
          },
        });
      }

      const deleteFailed = await createFile(
        FileStatus.DELETE_FAILED,
        { withCanonical: true },
      );
      storage.register(deleteFailed);
      const deleteJob = await prisma.mediaCleanupJob.create({
        data: {
          fileId: deleteFailed.id,
          kind: MediaCleanupKind.FILE_DELETE,
          nextAttemptAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      });

      const result = await maintenance.runOnce({
        ...options,
        batchSize: 1,
      });

      assert.equal(result.jobsClaimed, 1);
      assert.equal(result.succeeded, 1);
      assert.equal(result.dueJobsRemaining, 3);
      assert.equal(result.nonTerminalJobs, 3);
      assert.ok(result.oldestDueAt);
      assert.equal(
        (
          await prisma.mediaCleanupJob.findUniqueOrThrow({
            where: { id: deleteJob.id },
          })
        ).status,
        MediaCleanupStatus.SUCCEEDED,
      );
      assert.equal(
        (
          await prisma.fileMeta.findUniqueOrThrow({
            where: { id: deleteFailed.id },
          })
        ).status,
        FileStatus.DELETED,
      );
    },
  );

  await t.test(
    'cycle lease cancellation stops the real worker before claiming another job',
    async () => {
      await resetDatabase();
      const storage = new FakeStorageProvider();
      const maintenance = createMaintenance(
        'cleanup-cycle-cancel',
        storage,
      );
      const first = await createFile(FileStatus.REJECTED);
      const second = await createFile(FileStatus.REJECTED);
      storage.register(first);
      storage.register(second);
      const firstJob = await prisma.mediaCleanupJob.create({
        data: {
          fileId: first.id,
          kind: MediaCleanupKind.ORPHAN_PURGE,
          cleanPasses: 1,
          nextAttemptAt: new Date('1990-01-01T00:00:00.000Z'),
        },
      });
      const secondJob = await prisma.mediaCleanupJob.create({
        data: {
          fileId: second.id,
          kind: MediaCleanupKind.ORPHAN_PURGE,
          nextAttemptAt: new Date('1991-01-01T00:00:00.000Z'),
        },
      });
      const cycleAbort = new AbortController();
      storage.deleteHook = async (locator) => {
        if (locator.publicId === first.publicId) {
          cycleAbort.abort(new Error('simulated cycle lease loss'));
        }
      };

      const result = await maintenance.runOnce(options, {
        signal: cycleAbort.signal,
        isCycleLeaseValid: () => !cycleAbort.signal.aborted,
      });

      assert.equal(result.jobsClaimed, 1);
      assert.equal(result.retried, 1);
      assert.deepEqual(storage.deleteCalls, [first.publicId]);
      const [firstState, secondState] = await Promise.all([
        prisma.mediaCleanupJob.findUniqueOrThrow({
          where: { id: firstJob.id },
        }),
        prisma.mediaCleanupJob.findUniqueOrThrow({
          where: { id: secondJob.id },
        }),
      ]);
      assert.equal(firstState.status, MediaCleanupStatus.RETRY);
      assert.equal(
        firstState.cleanPasses,
        0,
        'deletion must reset clean passes even when the cycle lease is lost',
      );
      assert.equal(
        firstState.lastErrorCode,
        'CLEANUP_CYCLE_LEASE_LOST',
      );
      assert.equal(firstState.attemptCount, 1);
      assert.equal(secondState.status, MediaCleanupStatus.READY);
      assert.equal(secondState.attemptCount, 0);
      assert.equal(
        await prisma.mediaCleanupEvent.count({
          where: {
            jobId: secondJob.id,
            eventType: MediaCleanupEventType.CLAIMED,
          },
        }),
        0,
      );
    },
  );

  await t.test(
    'an expired job lease cannot finalize before another worker reclaims it',
    async () => {
      await resetDatabase();
      const storage = new FakeStorageProvider();
      const file = await createFile(FileStatus.REJECTED);
      storage.register(file);
      const workerA = createMaintenance(
        'cleanup-expired-finalize-a',
        storage,
      );
      storage.deleteDelayMs = 80;

      const staleResult = await workerA.runOnce({
        ...options,
        batchSize: 1,
        leaseMs: 30,
      });
      assert.equal(staleResult.fenceLost, 1);
      let job = await prisma.mediaCleanupJob.findFirstOrThrow({
        where: { fileId: file.id },
      });
      assert.equal(job.status, MediaCleanupStatus.RUNNING);
      assert.equal(job.attemptCount, 1);
      assert.ok(
        job.leaseUntil.getTime() < (await databaseNow()).getTime(),
      );
      assert.deepEqual(
        (
          await prisma.mediaCleanupEvent.findMany({
            where: { jobId: job.id },
            orderBy: { id: 'asc' },
          })
        ).map((event) => event.eventType),
        [
          MediaCleanupEventType.CLAIMED,
          MediaCleanupEventType.FENCE_LOST,
        ],
      );

      storage.deleteDelayMs = 0;
      const workerB = createMaintenance(
        'cleanup-expired-finalize-b',
        storage,
      );
      const reclaimed = await workerB.runOnce({
        ...options,
        batchSize: 1,
      });
      assert.equal(reclaimed.jobsClaimed, 1);
      assert.equal(reclaimed.retried, 1);
      job = await prisma.mediaCleanupJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      assert.equal(job.status, MediaCleanupStatus.RETRY);
      assert.equal(job.attemptCount, 2);
      assert.equal(job.leaseFence, 2);
    },
  );

  await t.test(
    'expired job lease is reclaimed and stale worker is fenced',
    async () => {
      await resetDatabase();
      const storage = new FakeStorageProvider();
      const file = await createFile(FileStatus.REJECTED);
      storage.register(file);
      await prisma.mediaCleanupJob.create({
        data: {
          fileId: file.id,
          kind: MediaCleanupKind.ORPHAN_PURGE,
          nextAttemptAt: new Date('2000-01-01T00:00:00.000Z'),
        },
      });

      const workerA = createMaintenance('cleanup-fence-a', storage);
      const workerB = createMaintenance('cleanup-fence-b', storage);
      let firstDeleteEntered;
      const entered = new Promise((resolve) => {
        firstDeleteEntered = resolve;
      });
      let releaseFirstDelete;
      const released = new Promise((resolve) => {
        releaseFirstDelete = resolve;
      });
      let targetCalls = 0;
      storage.deleteHook = async (locator) => {
        if (locator.publicId !== file.publicId) return;
        targetCalls += 1;
        if (targetCalls === 1) {
          firstDeleteEntered();
          await released;
        }
      };

      const shortLeaseOptions = {
        ...options,
        batchSize: 1,
        leaseMs: 50,
      };
      const staleRun = workerA.runOnce(shortLeaseOptions);
      await entered;
      await new Promise((resolve) => setTimeout(resolve, 80));

      const winningRun = await workerB.runOnce(
        shortLeaseOptions,
      );
      assert.equal(winningRun.retried, 1);
      releaseFirstDelete();
      const staleResult = await staleRun;
      storage.deleteHook = null;

      assert.equal(staleResult.fenceLost, 1);
      const job = await prisma.mediaCleanupJob.findFirstOrThrow({
        where: { fileId: file.id },
      });
      assert.equal(job.status, MediaCleanupStatus.RETRY);
      assert.equal(job.attemptCount, 2);
      assert.equal(job.leaseFence, 2);

      const events = await prisma.mediaCleanupEvent.findMany({
        where: { jobId: job.id },
        orderBy: { id: 'asc' },
      });
      assert.deepEqual(
        events.map((event) => event.eventType),
        [
          MediaCleanupEventType.CLAIMED,
          MediaCleanupEventType.CLAIMED,
          MediaCleanupEventType.RETRY_SCHEDULED,
          MediaCleanupEventType.FENCE_LOST,
        ],
      );
    },
  );
});
