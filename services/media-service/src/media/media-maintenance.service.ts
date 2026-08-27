import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FileMeta,
  FileStatus,
  MediaCleanupEventType,
  MediaCleanupJob,
  MediaCleanupKind,
  MediaCleanupStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssetLocator,
  StorageProvider,
} from '../storage/storage-provider';
import { MediaService } from './media.service';

export const MEDIA_CLEANUP_WORKER_ID = Symbol(
  'MEDIA_CLEANUP_WORKER_ID',
);

const PROVIDER_SIGNATURE_WINDOW_MS = 60 * 60 * 1000;
const CONFIRMATION_LEASE_MS = 5 * 60 * 1000;
const REQUIRED_CLEAN_PASSES = 2;
const MAX_PROVIDER_CALLS_PER_JOB = 7;
const CYCLE_LEASE_WATCHDOG_MARGIN_MS = 1000;
const SCHEDULE_CONTROL_NAME = 'media-cleanup';
const PURGEABLE_STATUSES = new Set<FileStatus>([
  FileStatus.EXPIRED,
  FileStatus.REJECTED,
  FileStatus.DELETED,
]);

export interface MediaMaintenanceOptions {
  batchSize: number;
  leaseMs: number;
  providerTimeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  providerGraceMs: number;
  cleanIntervalMs: number;
  expiredRetentionMs: number;
}

export interface MediaMaintenanceResult {
  expired: number;
  confirmationLeasesRecovered: number;
  jobsDiscovered: number;
  jobsClaimed: number;
  succeeded: number;
  retried: number;
  cancelled: number;
  fenceLost: number;
  dueJobsRemaining: number;
  nonTerminalJobs: number;
  oldestDueAt: string | null;
}

export interface MediaMaintenanceExecution {
  isCycleLeaseValid?: () => boolean;
  signal?: AbortSignal;
}

type JobOutcome =
  | 'SUCCEEDED'
  | 'RETRY'
  | 'CANCELLED'
  | 'FENCE_LOST';

interface JobFinalization {
  cleanPasses: number;
  nextAttemptAt: Date;
  completedAt: Date | null;
  lastErrorCode: string | null;
}

@Injectable()
export class MediaMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly media: MediaService,
    @Inject(MEDIA_CLEANUP_WORKER_ID)
    private readonly workerId: string,
  ) {}

  async tryAcquireScheduledCycle(
    intervalMs: number,
    cycleLeaseMs: number,
  ): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO "media"."media_maintenance_control" (
          "name", "next_run_at", "updated_at"
        ) VALUES (
          ${SCHEDULE_CONTROL_NAME}, clock_timestamp(), clock_timestamp()
        ) ON CONFLICT ("name") DO NOTHING`,
      );
      const claimed = await tx.$queryRaw<
        Array<{ leaseFence: number }>
      >(
        Prisma.sql`UPDATE "media"."media_maintenance_control"
          SET "next_run_at" = clock_timestamp()
                + (${intervalMs} * INTERVAL '1 millisecond'),
              "lease_owner" = ${this.workerId},
              "lease_fence" = "lease_fence" + 1,
              "lease_until" = clock_timestamp()
                + (${cycleLeaseMs} * INTERVAL '1 millisecond'),
              "updated_at" = clock_timestamp()
          WHERE "name" = ${SCHEDULE_CONTROL_NAME}
            AND "next_run_at" <= clock_timestamp()
            AND (
              "lease_until" IS NULL
              OR "lease_until" <= clock_timestamp()
            )
          RETURNING "lease_fence" AS "leaseFence"`,
      );
      return claimed[0]?.leaseFence ?? null;
    });
  }

  async renewScheduledCycle(
    leaseFence: number,
    cycleLeaseMs: number,
  ): Promise<boolean> {
    const updated = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "media"."media_maintenance_control"
        SET "lease_until" = clock_timestamp()
              + (${cycleLeaseMs} * INTERVAL '1 millisecond'),
            "updated_at" = clock_timestamp()
        WHERE "name" = ${SCHEDULE_CONTROL_NAME}
          AND "lease_owner" = ${this.workerId}
          AND "lease_fence" = ${leaseFence}
          AND "lease_until" > clock_timestamp()`,
    );
    return updated === 1;
  }

  async completeScheduledCycle(
    leaseFence: number,
    intervalMs: number,
  ): Promise<boolean> {
    const updated = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "media"."media_maintenance_control"
        SET "next_run_at" = clock_timestamp()
              + (${intervalMs} * INTERVAL '1 millisecond'),
            "lease_owner" = NULL,
            "lease_until" = NULL,
            "updated_at" = clock_timestamp()
        WHERE "name" = ${SCHEDULE_CONTROL_NAME}
          AND "lease_owner" = ${this.workerId}
          AND "lease_fence" = ${leaseFence}
          AND "lease_until" > clock_timestamp()`,
    );
    return updated === 1;
  }

  async runOnce(
    options: MediaMaintenanceOptions,
    execution: MediaMaintenanceExecution = {},
  ): Promise<MediaMaintenanceResult> {
    this.assertOptions(options);
    const result: MediaMaintenanceResult = {
      expired: 0,
      confirmationLeasesRecovered: 0,
      jobsDiscovered: 0,
      jobsClaimed: 0,
      succeeded: 0,
      retried: 0,
      cancelled: 0,
      fenceLost: 0,
      dueJobsRemaining: 0,
      nonTerminalJobs: 0,
      oldestDueAt: null,
    };
    const discoveryLimit = Math.max(options.batchSize * 4, 20);
    if (this.executionActive(execution)) {
      const lifecycle = await this.reconcileLifecycle(
        discoveryLimit,
        options,
        execution,
      );
      result.expired = lifecycle.expired;
      result.confirmationLeasesRecovered = lifecycle.recovered;
      result.jobsDiscovered =
        lifecycle.jobs +
        (await this.discoverMissingJobs(
          discoveryLimit,
          options,
          execution,
        ));
    }

    for (let index = 0; index < options.batchSize; index += 1) {
      if (!this.executionActive(execution)) break;
      const job = await this.claimNextJob(options.leaseMs);
      if (!job) {
        break;
      }
      result.jobsClaimed += 1;
      const outcome = this.executionActive(execution)
        ? await this.processJob(job, options, execution)
        : await this.deferForLeaseLoss(job, null);
      if (outcome === 'SUCCEEDED') result.succeeded += 1;
      if (outcome === 'RETRY') result.retried += 1;
      if (outcome === 'CANCELLED') result.cancelled += 1;
      if (outcome === 'FENCE_LOST') result.fenceLost += 1;
    }
    const backlog = await this.readBacklog();
    result.dueJobsRemaining = backlog.dueJobsRemaining;
    result.nonTerminalJobs = backlog.nonTerminalJobs;
    result.oldestDueAt = backlog.oldestDueAt?.toISOString() ?? null;
    return result;
  }

  private async reconcileLifecycle(
    limit: number,
    options: MediaMaintenanceOptions,
    execution: MediaMaintenanceExecution,
  ): Promise<{ expired: number; recovered: number; jobs: number }> {
    const now = await this.databaseNow();
    let expired = 0;
    let recovered = 0;
    let jobs = 0;

    const pending = await this.prisma.fileMeta.findMany({
      where: {
        status: FileStatus.PENDING,
        intentExpiresAt: { lte: now },
      },
      orderBy: [{ intentExpiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    for (const file of pending) {
      if (!this.executionActive(execution)) break;
      const changed = await this.prisma.$transaction(async (tx) => {
        const update = await tx.fileMeta.updateMany({
          where: {
            id: file.id,
            status: FileStatus.PENDING,
            aggregateVersion: file.aggregateVersion,
            intentExpiresAt: { lte: now },
          },
          data: {
            status: FileStatus.EXPIRED,
            confirmationRetryAt: null,
            lastErrorCode: 'FILE_INTENT_EXPIRED',
            aggregateVersion: { increment: 1 },
          },
        });
        if (update.count !== 1) return false;
        await this.insertJob(
          tx,
          file,
          MediaCleanupKind.ORPHAN_PURGE,
          this.purgeDueAt(file, FileStatus.EXPIRED, options),
        );
        return true;
      });
      if (changed) {
        expired += 1;
        jobs += 1;
      }
    }

    const leaseCutoff = new Date(
      now.getTime() - CONFIRMATION_LEASE_MS,
    );
    const verifying = await this.prisma.fileMeta.findMany({
      where: {
        status: FileStatus.VERIFYING,
        updatedAt: { lte: leaseCutoff },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    for (const file of verifying) {
      if (!this.executionActive(execution)) break;
      const shouldExpire = file.intentExpiresAt.getTime() <= now.getTime();
      const changed = await this.prisma.$transaction(async (tx) => {
        const update = await tx.fileMeta.updateMany({
          where: {
            id: file.id,
            status: FileStatus.VERIFYING,
            aggregateVersion: file.aggregateVersion,
            updatedAt: { lte: leaseCutoff },
          },
          data: {
            status: shouldExpire
              ? FileStatus.EXPIRED
              : FileStatus.PENDING,
            confirmationRetryAt: null,
            lastErrorCode: shouldExpire
              ? 'FILE_INTENT_EXPIRED'
              : 'FILE_CONFIRM_LEASE_EXPIRED',
            aggregateVersion: { increment: 1 },
          },
        });
        if (update.count !== 1) return false;
        if (shouldExpire) {
          await this.insertJob(
            tx,
            file,
            MediaCleanupKind.ORPHAN_PURGE,
            this.purgeDueAt(file, FileStatus.EXPIRED, options),
          );
        }
        return true;
      });
      if (changed) {
        recovered += 1;
        if (shouldExpire) jobs += 1;
      }
    }
    return { expired, recovered, jobs };
  }

  private async discoverMissingJobs(
    limit: number,
    options: MediaMaintenanceOptions,
    execution: MediaMaintenanceExecution,
  ): Promise<number> {
    if (!this.executionActive(execution)) return 0;
    const now = await this.databaseNow();
    const staleDeleteCutoff = new Date(
      now.getTime() - CONFIRMATION_LEASE_MS,
    );
    const [purgeFiles, activeFiles, deleteFiles] = await Promise.all([
      this.prisma.fileMeta.findMany({
        where: {
          status: {
            in: [
              FileStatus.EXPIRED,
              FileStatus.REJECTED,
              FileStatus.DELETED,
            ],
          },
          cleanupJobs: {
            none: { kind: MediaCleanupKind.ORPHAN_PURGE },
          },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit,
      }),
      this.prisma.fileMeta.findMany({
        where: {
          status: FileStatus.ACTIVE,
          cleanupJobs: {
            none: { kind: MediaCleanupKind.SIBLING_SWEEP },
          },
        },
        orderBy: [{ intentExpiresAt: 'asc' }, { id: 'asc' }],
        take: limit,
      }),
      this.prisma.fileMeta.findMany({
        where: {
          OR: [
            { status: FileStatus.DELETE_FAILED },
            {
              status: FileStatus.DELETE_PENDING,
              updatedAt: { lte: staleDeleteCutoff },
            },
          ],
          cleanupJobs: {
            none: { kind: MediaCleanupKind.FILE_DELETE },
          },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit,
      }),
    ]);

    let inserted = 0;
    for (const file of purgeFiles) {
      if (!this.executionActive(execution)) break;
      inserted += await this.insertJob(
        this.prisma,
        file,
        MediaCleanupKind.ORPHAN_PURGE,
        this.purgeDueAt(file, file.status, options),
      );
    }
    for (const file of activeFiles) {
      if (!this.executionActive(execution)) break;
      inserted += await this.insertJob(
        this.prisma,
        file,
        MediaCleanupKind.SIBLING_SWEEP,
        this.providerStableAt(file, options.providerGraceMs),
      );
    }
    for (const file of deleteFiles) {
      if (!this.executionActive(execution)) break;
      inserted += await this.insertJob(
        this.prisma,
        file,
        MediaCleanupKind.FILE_DELETE,
        now,
      );
    }
    return inserted;
  }

  private async insertJob(
    tx: Prisma.TransactionClient | PrismaService,
    file: FileMeta,
    kind: MediaCleanupKind,
    nextAttemptAt: Date,
  ): Promise<number> {
    return tx.$executeRaw(
      Prisma.sql`INSERT INTO "media"."media_cleanup_job" (
        "id", "file_id", "kind", "status", "next_attempt_at"
      ) VALUES (
        ${randomUUID()}::uuid,
        ${file.id}::uuid,
        CAST(${kind} AS "media"."media_cleanup_kind"),
        'READY',
        ${nextAttemptAt}
      ) ON CONFLICT ("file_id", "kind") DO NOTHING`,
    );
  }

  private providerStableAt(
    file: FileMeta,
    providerGraceMs: number,
  ): Date {
    return new Date(
      Math.max(
        file.intentExpiresAt.getTime(),
        file.signatureTimestamp * 1000 + PROVIDER_SIGNATURE_WINDOW_MS,
      ) + providerGraceMs,
    );
  }

  private purgeDueAt(
    file: FileMeta,
    status: FileStatus,
    options: MediaMaintenanceOptions,
  ): Date {
    const providerStableAt = this.providerStableAt(
      file,
      options.providerGraceMs,
    );
    if (status !== FileStatus.EXPIRED) {
      return providerStableAt;
    }
    return new Date(
      Math.max(
        providerStableAt.getTime(),
        file.createdAt.getTime() + options.expiredRetentionMs,
      ),
    );
  }

  private async claimNextJob(
    leaseMs: number,
  ): Promise<MediaCleanupJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.$queryRaw<MediaCleanupJob[]>(
        Prisma.sql`WITH candidate AS (
          SELECT "id"
          FROM "media"."media_cleanup_job"
          WHERE (
            "status" IN ('READY', 'RETRY')
            AND "next_attempt_at" <= clock_timestamp()
          ) OR (
            "status" = 'RUNNING'
            AND "lease_until" <= clock_timestamp()
          )
          ORDER BY
            CASE "kind"
              WHEN 'FILE_DELETE' THEN 0
              WHEN 'ORPHAN_PURGE' THEN 1
              ELSE 2
            END,
            COALESCE("lease_until", "next_attempt_at"),
            "id"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "media"."media_cleanup_job" AS job
        SET "status" = 'RUNNING',
            "attempt_count" = job."attempt_count" + 1,
            "lease_owner" = ${this.workerId},
            "lease_fence" = job."lease_fence" + 1,
            "lease_until" = clock_timestamp()
              + (${leaseMs} * INTERVAL '1 millisecond'),
            "last_error_code" = NULL
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING
          job."id",
          job."file_id" AS "fileId",
          job."kind",
          job."status",
          job."attempt_count" AS "attemptCount",
          job."clean_passes" AS "cleanPasses",
          job."next_attempt_at" AS "nextAttemptAt",
          job."lease_owner" AS "leaseOwner",
          job."lease_fence" AS "leaseFence",
          job."lease_until" AS "leaseUntil",
          job."last_error_code" AS "lastErrorCode",
          job."completed_at" AS "completedAt",
          job."created_at" AS "createdAt",
          job."updated_at" AS "updatedAt"`,
      );
      const job = jobs[0];
      if (!job) return null;
      await tx.mediaCleanupEvent.create({
        data: {
          jobId: job.id,
          eventType: MediaCleanupEventType.CLAIMED,
          attemptCount: job.attemptCount,
          leaseFence: job.leaseFence,
          workerId: this.workerId,
        },
      });
      return job;
    });
  }

  private async processJob(
    job: MediaCleanupJob,
    options: MediaMaintenanceOptions,
    execution: MediaMaintenanceExecution,
  ): Promise<JobOutcome> {
    try {
      if (!this.executionActive(execution)) {
        return this.deferForLeaseLoss(job, null);
      }
      const file = await this.prisma.fileMeta.findUnique({
        where: { id: job.fileId },
      });
      if (!file) {
        return this.finalizeCancelled(
          job,
          'FILE_METADATA_MISSING',
        );
      }
      if (job.kind === MediaCleanupKind.FILE_DELETE) {
        return await this.processFileDelete(
          job,
          file,
          options,
          execution,
        );
      }
      return await this.processAssetReconciliation(
        job,
        file,
        options,
        execution,
      );
    } catch (error) {
      return this.finalizeFailure(
        job,
        this.errorCode(error),
        options,
      );
    }
  }

  private async processFileDelete(
    job: MediaCleanupJob,
    file: FileMeta,
    options: MediaMaintenanceOptions,
    execution: MediaMaintenanceExecution,
  ): Promise<JobOutcome> {
    if (file.status === FileStatus.DELETED) {
      return this.finalizeSuccess(job, null);
    }
    if (
      file.status !== FileStatus.DELETE_FAILED &&
      file.status !== FileStatus.DELETE_PENDING
    ) {
      return this.finalizeCancelled(
        job,
        'FILE_DELETE_STATE_CHANGED',
      );
    }
    if (!this.executionActive(execution)) {
      return this.deferForLeaseLoss(job, null);
    }
    await this.media.deleteForMaintenance(
      file.id,
      options.providerTimeoutMs,
      execution.signal,
    );
    return this.finalizeSuccess(job, null);
  }

  private async processAssetReconciliation(
    job: MediaCleanupJob,
    file: FileMeta,
    options: MediaMaintenanceOptions,
    execution: MediaMaintenanceExecution,
  ): Promise<JobOutcome> {
    const siblingSweep =
      job.kind === MediaCleanupKind.SIBLING_SWEEP;
    if (siblingSweep && file.status !== FileStatus.ACTIVE) {
      return this.finalizeCancelled(
        job,
        'FILE_NO_LONGER_ACTIVE',
      );
    }
    if (
      !siblingSweep &&
      !PURGEABLE_STATUSES.has(file.status)
    ) {
      return this.finalizeCancelled(
        job,
        'FILE_NOT_PURGEABLE',
      );
    }

    const locator = this.toLocator(file);
    if (!this.executionActive(execution)) {
      return this.deferForLeaseLoss(job, null);
    }
    const exactDeleted = siblingSweep
      ? false
      : await this.storage.deleteAsset(locator, {
          timeoutMs: options.providerTimeoutMs,
          signal: execution.signal,
        });
    if (!this.executionActive(execution)) {
      return this.deferForLeaseLoss(
        job,
        exactDeleted ? 1 : null,
      );
    }
    const reconciliation =
      await this.storage.reconcileIntentAssets(
        file.id,
        siblingSweep ? locator : null,
        {
          timeoutMs: options.providerTimeoutMs,
          signal: execution.signal,
        },
      );
    const deletedAssets =
      reconciliation.deletedAssets + (exactDeleted ? 1 : 0);
    if (!this.executionActive(execution)) {
      return this.deferForLeaseLoss(job, deletedAssets);
    }
    if (siblingSweep && !reconciliation.preservedExpectedAsset) {
      throw new Error('FILE_CANONICAL_ASSET_MISSING');
    }
    if (deletedAssets > 0) {
      const now = await this.databaseNow();
      return this.finalizeRetry(
        job,
        0,
        new Date(now.getTime() + options.cleanIntervalMs),
        null,
        deletedAssets,
      );
    }
    const cleanPasses = Math.min(
      job.cleanPasses + 1,
      REQUIRED_CLEAN_PASSES,
    );
    if (cleanPasses === REQUIRED_CLEAN_PASSES) {
      return this.finalizeSuccess(job, 0);
    }
    const now = await this.databaseNow();
    return this.finalizeRetry(
      job,
      cleanPasses,
      new Date(now.getTime() + options.cleanIntervalMs),
      null,
      0,
    );
  }

  private toLocator(file: FileMeta): AssetLocator {
    return {
      publicId: file.publicId,
      resourceType: file.storageResourceType,
      deliveryType: file.storageDeliveryType,
      expectedFormat: file.expectedFormat,
      contextFileId: file.id,
      expectedAssetId: file.assetId ?? undefined,
    };
  }

  private async finalizeFailure(
    job: MediaCleanupJob,
    errorCode: string,
    options: MediaMaintenanceOptions,
  ): Promise<JobOutcome> {
    const exponential = Math.min(
      options.retryBaseMs * 2 ** Math.max(job.attemptCount - 1, 0),
      options.retryMaxMs,
    );
    const now = await this.databaseNow();
    return this.finalizeRetry(
      job,
      0,
      new Date(now.getTime() + exponential),
      errorCode,
      null,
    );
  }

  private async deferForLeaseLoss(
    job: MediaCleanupJob,
    deletedAssets: number | null,
  ): Promise<JobOutcome> {
    const now = await this.databaseNow();
    return this.finalizeRetry(
      job,
      deletedAssets !== null && deletedAssets > 0
        ? 0
        : job.cleanPasses,
      now,
      'CLEANUP_CYCLE_LEASE_LOST',
      deletedAssets,
    );
  }

  private async finalizeRetry(
    job: MediaCleanupJob,
    cleanPasses: number,
    nextAttemptAt: Date,
    errorCode: string | null,
    deletedAssets: number | null,
  ): Promise<JobOutcome> {
    return this.finalizeJob(
      job,
      MediaCleanupStatus.RETRY,
      MediaCleanupEventType.RETRY_SCHEDULED,
      {
        cleanPasses,
        nextAttemptAt,
        lastErrorCode: errorCode,
        completedAt: null,
      },
      errorCode,
      deletedAssets,
      'RETRY',
    );
  }

  private async finalizeSuccess(
    job: MediaCleanupJob,
    deletedAssets: number | null,
  ): Promise<JobOutcome> {
    const now = await this.databaseNow();
    return this.finalizeJob(
      job,
      MediaCleanupStatus.SUCCEEDED,
      MediaCleanupEventType.SUCCEEDED,
      {
        cleanPasses:
          job.kind === MediaCleanupKind.FILE_DELETE
            ? job.cleanPasses
            : REQUIRED_CLEAN_PASSES,
        nextAttemptAt: job.nextAttemptAt,
        completedAt: now,
        lastErrorCode: null,
      },
      null,
      deletedAssets,
      'SUCCEEDED',
    );
  }

  private async finalizeCancelled(
    job: MediaCleanupJob,
    errorCode: string,
  ): Promise<JobOutcome> {
    const now = await this.databaseNow();
    return this.finalizeJob(
      job,
      MediaCleanupStatus.CANCELLED,
      MediaCleanupEventType.CANCELLED,
      {
        cleanPasses: job.cleanPasses,
        nextAttemptAt: job.nextAttemptAt,
        completedAt: now,
        lastErrorCode: errorCode,
      },
      errorCode,
      null,
      'CANCELLED',
    );
  }

  private async finalizeJob(
    job: MediaCleanupJob,
    status: MediaCleanupStatus,
    eventType: MediaCleanupEventType,
    data: JobFinalization,
    errorCode: string | null,
    deletedAssets: number | null,
    outcome: Exclude<JobOutcome, 'FENCE_LOST'>,
  ): Promise<JobOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`UPDATE "media"."media_cleanup_job"
          SET "status" = CAST(
                ${status} AS "media"."media_cleanup_status"
              ),
              "clean_passes" = ${data.cleanPasses},
              "next_attempt_at" = ${data.nextAttemptAt},
              "last_error_code" = ${data.lastErrorCode},
              "completed_at" = ${data.completedAt},
              "lease_owner" = NULL,
              "lease_until" = NULL,
              "updated_at" = clock_timestamp()
          WHERE "id" = ${job.id}::uuid
            AND "status" = 'RUNNING'
            AND "lease_owner" = ${this.workerId}
            AND "lease_fence" = ${job.leaseFence}
            AND "lease_until" > clock_timestamp()
          RETURNING "id"`,
      );
      if (updated.length !== 1) {
        await tx.mediaCleanupEvent.create({
          data: {
            jobId: job.id,
            eventType: MediaCleanupEventType.FENCE_LOST,
            attemptCount: job.attemptCount,
            leaseFence: job.leaseFence,
            workerId: this.workerId,
            errorCode: 'CLEANUP_FENCE_LOST',
            deletedAssets,
          },
        });
        return 'FENCE_LOST';
      }
      await tx.mediaCleanupEvent.create({
        data: {
          jobId: job.id,
          eventType,
          attemptCount: job.attemptCount,
          leaseFence: job.leaseFence,
          workerId: this.workerId,
          errorCode,
          deletedAssets,
        },
      });
      return outcome;
    });
  }

  private async databaseNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT clock_timestamp() AS "now"`,
    );
    const now = rows[0]?.now;
    if (!(now instanceof Date)) {
      throw new Error('Database clock is unavailable');
    }
    return now;
  }

  private executionActive(
    execution: MediaMaintenanceExecution,
  ): boolean {
    return (
      execution.signal?.aborted !== true &&
      execution.isCycleLeaseValid?.() !== false
    );
  }

  private async readBacklog(): Promise<{
    dueJobsRemaining: number;
    nonTerminalJobs: number;
    oldestDueAt: Date | null;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        dueJobsRemaining: number;
        nonTerminalJobs: number;
        oldestDueAt: Date | null;
      }>
    >(
      Prisma.sql`SELECT
        COUNT(*) FILTER (
          WHERE "status" IN ('READY', 'RUNNING', 'RETRY')
        )::integer AS "nonTerminalJobs",
        COUNT(*) FILTER (
          WHERE (
            "status" IN ('READY', 'RETRY')
            AND "next_attempt_at" <= clock_timestamp()
          ) OR (
            "status" = 'RUNNING'
            AND "lease_until" <= clock_timestamp()
          )
        )::integer AS "dueJobsRemaining",
        MIN(
          CASE
            WHEN (
              "status" IN ('READY', 'RETRY')
              AND "next_attempt_at" <= clock_timestamp()
            ) OR (
              "status" = 'RUNNING'
              AND "lease_until" <= clock_timestamp()
            )
            THEN COALESCE("lease_until", "next_attempt_at")
            ELSE NULL
          END
        ) AS "oldestDueAt"
      FROM "media"."media_cleanup_job"`,
    );
    return (
      rows[0] ?? {
        dueJobsRemaining: 0,
        nonTerminalJobs: 0,
        oldestDueAt: null,
      }
    );
  }

  private errorCode(error: unknown): string {
    if (error instanceof ApiException) {
      const response = error.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof response.code === 'string'
      ) {
        return response.code;
      }
    }
    if (
      error instanceof Error &&
      /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
    ) {
      return error.message;
    }
    return 'STORAGE_UNAVAILABLE';
  }

  private assertOptions(options: MediaMaintenanceOptions): void {
    for (const value of Object.values(options)) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('Media maintenance options must be positive integers');
      }
    }
  }
}

interface SchedulerConfiguration {
  enabled: boolean;
  intervalMs: number;
  cycleLeaseMs: number;
  startupJitterMs: number;
  maintenance: MediaMaintenanceOptions;
}

@Injectable()
export class MediaCleanupScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MediaCleanupScheduler.name);
  private configuration?: SchedulerConfiguration;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private activeCycleAbort?: AbortController;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly maintenance: MediaMaintenanceService,
  ) {}

  assertConfiguration(): void {
    this.configuration = this.readConfiguration();
  }

  onApplicationBootstrap(): void {
    const configuration =
      this.configuration ?? this.readConfiguration();
    this.configuration = configuration;
    if (!configuration.enabled) return;
    const jitter =
      configuration.startupJitterMs === 0
        ? 0
        : Math.floor(
            Math.random() * (configuration.startupJitterMs + 1),
          );
    this.schedule(jitter);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.activeCycleAbort?.abort(
      new Error('Media cleanup scheduler is shutting down'),
    );
    await this.running;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const configuration = this.configuration as SchedulerConfiguration;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let heartbeatInFlight: Promise<void> | undefined;
    let leaseWatchdogTimer: NodeJS.Timeout | undefined;
    let cycleAbort: AbortController | undefined;
    try {
      const acquisitionStartedAt = performance.now();
      const leaseFence =
        await this.maintenance.tryAcquireScheduledCycle(
        configuration.intervalMs,
        configuration.cycleLeaseMs,
      );
      if (leaseFence !== null) {
        if (this.stopped) {
          await this.maintenance.completeScheduledCycle(
            leaseFence,
            0,
          );
          return;
        }
        cycleAbort = new AbortController();
        const cycleSignal = cycleAbort.signal;
        this.activeCycleAbort = cycleAbort;
        const abortCycle = (message: string): void => {
          if (!cycleSignal.aborted) {
            cycleAbort?.abort(new Error(message));
          }
        };
        const armLeaseWatchdog = (elapsedMs: number): void => {
          if (leaseWatchdogTimer) clearTimeout(leaseWatchdogTimer);
          const delayMs = Math.max(
            1,
            configuration.cycleLeaseMs -
              Math.ceil(elapsedMs) -
              CYCLE_LEASE_WATCHDOG_MARGIN_MS,
          );
          leaseWatchdogTimer = setTimeout(() => {
            this.logger.warn(
              'Media cleanup cycle lease watchdog expired',
            );
            abortCycle('Media cleanup cycle lease watchdog expired');
          }, delayMs);
          leaseWatchdogTimer.unref();
        };
        armLeaseWatchdog(
          performance.now() - acquisitionStartedAt,
        );
        const heartbeatEveryMs = this.heartbeatIntervalMs(
          configuration.cycleLeaseMs,
        );
        heartbeatTimer = setInterval(() => {
          if (heartbeatInFlight) return;
          const renewalStartedAt = performance.now();
          heartbeatInFlight = this.maintenance
            .renewScheduledCycle(
              leaseFence,
              configuration.cycleLeaseMs,
            )
            .then((renewed) => {
              if (!renewed) {
                this.logger.warn(
                  'Media cleanup cycle lease was lost',
                );
                abortCycle('Media cleanup cycle lease was lost');
              } else if (!cycleSignal.aborted) {
                armLeaseWatchdog(
                  performance.now() - renewalStartedAt,
                );
              }
            })
            .catch((error: unknown) => {
              this.logger.error(
                'Media cleanup cycle heartbeat failed: ' +
                  (error instanceof Error
                    ? error.name
                    : 'UnknownError'),
              );
              abortCycle('Media cleanup cycle heartbeat failed');
            })
            .finally(() => {
              heartbeatInFlight = undefined;
            });
        }, heartbeatEveryMs);
        heartbeatTimer.unref();

        const result = await this.maintenance.runOnce(
          configuration.maintenance,
          {
            signal: cycleSignal,
            isCycleLeaseValid: () => !cycleSignal.aborted,
          },
        );
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        await this.waitForHeartbeat(
          heartbeatInFlight,
          cycleSignal,
        );
        const completed = cycleSignal.aborted
          ? false
          : await this.maintenance.completeScheduledCycle(
              leaseFence,
              configuration.intervalMs,
            );
        if (!completed && !cycleSignal.aborted) {
          this.logger.warn(
            'Media cleanup cycle completed after losing its lease',
          );
        }
        this.logger.log(
          'Media cleanup cycle finished ' +
            JSON.stringify({
              leaseCompleted: completed,
              aborted: cycleSignal.aborted,
              ...result,
            }),
        );
      }
    } catch (error) {
      cycleAbort?.abort(
        new Error('Media cleanup cycle failed before completion'),
      );
      this.logger.error(
        'Media cleanup cycle failed: ' +
          (error instanceof Error ? error.name : 'UnknownError'),
      );
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (leaseWatchdogTimer) clearTimeout(leaseWatchdogTimer);
      await this.waitForHeartbeat(
        heartbeatInFlight,
        cycleAbort?.signal,
      );
      this.activeCycleAbort = undefined;
      this.running = undefined;
      this.schedule(configuration.intervalMs);
    }
  }

  private heartbeatIntervalMs(cycleLeaseMs: number): number {
    return Math.max(5000, Math.floor(cycleLeaseMs / 3));
  }

  private async waitForHeartbeat(
    heartbeat: Promise<void> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (!heartbeat || signal?.aborted) return;
    if (!signal) {
      await heartbeat;
      return;
    }
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      onAbort = () => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([heartbeat, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private readConfiguration(): SchedulerConfiguration {
    const enabledValue = this.value('MEDIA_CLEANUP_ENABLED', 'false');
    if (enabledValue !== 'true' && enabledValue !== 'false') {
      throw new Error('MEDIA_CLEANUP_ENABLED must be true or false');
    }
    const intervalMs =
      this.integer('MEDIA_CLEANUP_INTERVAL_SECONDS', 300, 30, 3600) *
      1000;
    const leaseMs =
      this.integer('MEDIA_CLEANUP_LEASE_SECONDS', 300, 60, 1800) *
      1000;
    const providerTimeoutMs =
      this.integer(
        'MEDIA_CLEANUP_PROVIDER_TIMEOUT_SECONDS',
        20,
        1,
        60,
      ) * 1000;
    const minimumLeaseMs =
      providerTimeoutMs * MAX_PROVIDER_CALLS_PER_JOB + 10_000;
    if (leaseMs < minimumLeaseMs) {
      throw new Error(
        'MEDIA_CLEANUP_LEASE_SECONDS must cover provider timeout budget (7x timeout plus 10 seconds)',
      );
    }
    const retryBaseMs =
      this.integer(
        'MEDIA_CLEANUP_RETRY_BASE_SECONDS',
        30,
        5,
        3600,
      ) * 1000;
    const retryMaxMs =
      this.integer(
        'MEDIA_CLEANUP_RETRY_MAX_SECONDS',
        21600,
        30,
        86400,
      ) * 1000;
    if (retryMaxMs < retryBaseMs) {
      throw new Error(
        'MEDIA_CLEANUP_RETRY_MAX_SECONDS must be at least retry base',
      );
    }
    return {
      enabled: enabledValue === 'true',
      intervalMs,
      cycleLeaseMs: leaseMs,
      startupJitterMs:
        this.integer(
          'MEDIA_CLEANUP_STARTUP_JITTER_SECONDS',
          30,
          0,
          300,
        ) * 1000,
      maintenance: {
        batchSize: this.integer(
          'MEDIA_CLEANUP_BATCH_SIZE',
          5,
          1,
          20,
        ),
        leaseMs,
        providerTimeoutMs,
        retryBaseMs,
        retryMaxMs,
        providerGraceMs:
          this.integer(
            'MEDIA_CLEANUP_PROVIDER_GRACE_SECONDS',
            300,
            60,
            3600,
          ) * 1000,
        cleanIntervalMs:
          this.integer(
            'MEDIA_CLEANUP_CLEAN_INTERVAL_SECONDS',
            60,
            10,
            3600,
          ) * 1000,
        expiredRetentionMs:
          this.integer(
            'MEDIA_CLEANUP_EXPIRED_RETENTION_SECONDS',
            86400,
            3600,
            604800,
          ) * 1000,
      },
    };
  }

  private value(name: string, fallback: string): string {
    return (
      this.config.get<string>(name)?.trim().toLowerCase() ?? fallback
    );
  }

  private integer(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const raw = this.config.get<string>(name)?.trim();
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (
      !Number.isInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(
        name + ' must be an integer between ' + minimum + ' and ' + maximum,
      );
    }
    return value;
  }
}
