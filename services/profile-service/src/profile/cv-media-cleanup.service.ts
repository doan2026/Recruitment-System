import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CvMediaCleanupJob,
  CvMediaCleanupStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ApiException } from '../common/http/api-exception';
import {
  ProfileMediaClient,
  ProfileMediaType,
} from '../media/profile-media.client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MS = 45_000;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1000;

interface CleanupOptions {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  leaseMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

@Injectable()
export class CvMediaCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CvMediaCleanupService.name);
  private readonly workerId = randomUUID();
  private readonly options: CleanupOptions;
  private timer: NodeJS.Timeout | null = null;
  private cycleRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: ProfileMediaClient,
    config: ConfigService,
  ) {
    this.options = this.readOptions(config);
  }

  onApplicationBootstrap(): void {
    if (!this.options.enabled) return;
    this.timer = setInterval(() => {
      void this.runScheduledCycle();
    }, this.options.intervalMs);
    this.timer.unref();
    void this.runScheduledCycle();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tryCleanupCv(cvId: string): Promise<boolean> {
    const job = await this.claimNext(cvId);
    if (job) {
      await this.process(job);
    }
    return this.isComplete(cvId);
  }

  async runOnce(): Promise<number> {
    let processed = 0;
    for (
      let index = 0;
      index < this.options.batchSize;
      index += 1
    ) {
      const job = await this.claimNext(null);
      if (!job) break;
      await this.process(job);
      processed += 1;
    }
    return processed;
  }

  private async runScheduledCycle(): Promise<void> {
    if (this.cycleRunning) return;
    this.cycleRunning = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(
        'CV Media cleanup cycle failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.cycleRunning = false;
    }
  }

  private async claimNext(
    cvId: string | null,
  ): Promise<CvMediaCleanupJob | null> {
    const cvFilter =
      cvId === null
        ? Prisma.empty
        : Prisma.sql`AND job."cv_id" = ${cvId}::uuid`;
    const rows = await this.prisma.$queryRaw<CvMediaCleanupJob[]>(
      Prisma.sql`WITH candidate AS (
        SELECT job."id"
        FROM "profile"."cv_media_cleanup_job" AS job
        JOIN "profile"."cv_deletion_workflow" AS workflow
          ON workflow."cv_id" = job."cv_id"
         AND workflow."user_id" = job."user_id"
         AND workflow."file_id" = job."file_id"
         AND workflow."media_reference_id" = job."media_reference_id"
        WHERE (
          (
            job."status" IN ('PENDING', 'RETRY')
            AND job."next_attempt_at" <= clock_timestamp()
          )
          OR (
            job."status" = 'RUNNING'
            AND job."lease_until" <= clock_timestamp()
          )
        )
        AND workflow."state" = 'HARD_DELETED'
        ${cvFilter}
        ORDER BY COALESCE(
          job."lease_until",
          job."next_attempt_at"
        ), job."id"
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 1
      )
      UPDATE "profile"."cv_media_cleanup_job" AS job
      SET "status" = 'RUNNING',
          "attempt_count" = job."attempt_count" + 1,
          "lease_owner" = ${this.workerId},
          "lease_fence" = job."lease_fence" + 1,
          "lease_until" = clock_timestamp()
            + (${this.options.leaseMs} * INTERVAL '1 millisecond'),
          "last_error_code" = NULL,
          "updated_at" = clock_timestamp()
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING
        job."id",
        job."cv_id" AS "cvId",
        job."user_id" AS "userId",
        job."file_id" AS "fileId",
        job."media_reference_id" AS "mediaReferenceId",
        job."status",
        job."attempt_count" AS "attemptCount",
        job."next_attempt_at" AS "nextAttemptAt",
        job."lease_owner" AS "leaseOwner",
        job."lease_fence" AS "leaseFence",
        job."lease_until" AS "leaseUntil",
        job."reference_released_at" AS "referenceReleasedAt",
        job."file_deleted_at" AS "fileDeletedAt",
        job."last_error_code" AS "lastErrorCode",
        job."completed_at" AS "completedAt",
        job."created_at" AS "createdAt",
        job."updated_at" AS "updatedAt"`,
    );
    return rows[0] ?? null;
  }

  private async process(job: CvMediaCleanupJob): Promise<void> {
    try {
      if (job.referenceReleasedAt === null) {
        await this.media.releaseReference(job.mediaReferenceId);
        const marked = await this.markReferenceReleased(job);
        if (!marked) return;
      }

      await this.media.deleteUserFile(
        job.fileId,
        job.userId,
        ProfileMediaType.CV,
      );
      await this.finalizeSuccess(job);
    } catch (error) {
      await this.finalizeRetry(job, this.errorCode(error));
    }
  }

  private async markReferenceReleased(
    job: CvMediaCleanupJob,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ releasedAt: Date }>>(
      Prisma.sql`UPDATE "profile"."cv_media_cleanup_job"
        SET "reference_released_at" = COALESCE(
              "reference_released_at",
              clock_timestamp()
            ),
            "updated_at" = clock_timestamp()
        WHERE "id" = ${job.id}::uuid
          AND "status" = 'RUNNING'
          AND "lease_owner" = ${this.workerId}
          AND "lease_fence" = ${job.leaseFence}
          AND "lease_until" > clock_timestamp()
        RETURNING "reference_released_at" AS "releasedAt"`,
    );
    return rows.length === 1;
  }

  private async finalizeSuccess(
    job: CvMediaCleanupJob,
  ): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "profile"."cv_media_cleanup_job"
        SET "status" = 'SUCCEEDED',
            "reference_released_at" = COALESCE(
              "reference_released_at",
              clock_timestamp()
            ),
            "file_deleted_at" = COALESCE(
              "file_deleted_at",
              clock_timestamp()
            ),
            "completed_at" = clock_timestamp(),
            "lease_owner" = NULL,
            "lease_until" = NULL,
            "last_error_code" = NULL,
            "updated_at" = clock_timestamp()
        WHERE "id" = ${job.id}::uuid
          AND "status" = 'RUNNING'
          AND "lease_owner" = ${this.workerId}
          AND "lease_fence" = ${job.leaseFence}
          AND "lease_until" > clock_timestamp()`,
    );
  }

  private async finalizeRetry(
    job: CvMediaCleanupJob,
    errorCode: string,
  ): Promise<void> {
    const delay = Math.min(
      this.options.retryBaseMs *
        2 ** Math.max(job.attemptCount - 1, 0),
      this.options.retryMaxMs,
    );
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "profile"."cv_media_cleanup_job"
        SET "status" = 'RETRY',
            "next_attempt_at" = clock_timestamp()
              + (${delay} * INTERVAL '1 millisecond'),
            "lease_owner" = NULL,
            "lease_until" = NULL,
            "last_error_code" = ${errorCode},
            "updated_at" = clock_timestamp()
        WHERE "id" = ${job.id}::uuid
          AND "status" = 'RUNNING'
          AND "lease_owner" = ${this.workerId}
          AND "lease_fence" = ${job.leaseFence}
          AND "lease_until" > clock_timestamp()`,
    );
  }

  private async isComplete(cvId: string): Promise<boolean> {
    const job = await this.prisma.cvMediaCleanupJob.findUnique({
      where: { cvId },
      select: { status: true },
    });
    return job?.status === CvMediaCleanupStatus.SUCCEEDED;
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
        return this.safeErrorCode(response.code);
      }
    }
    return this.safeErrorCode(
      error instanceof Error ? error.name : 'MEDIA_CLEANUP_FAILED',
    );
  }

  private safeErrorCode(value: string): string {
    const normalized = value
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 96);
    return normalized || 'MEDIA_CLEANUP_FAILED';
  }

  private readOptions(config: ConfigService): CleanupOptions {
    const enabled = this.readBoolean(
      config,
      'CV_MEDIA_CLEANUP_ENABLED',
      true,
    );
    const intervalMs =
      this.readInteger(
        config,
        'CV_MEDIA_CLEANUP_INTERVAL_SECONDS',
        1,
        3600,
        DEFAULT_INTERVAL_MS / 1000,
      ) * 1000;
    const batchSize = this.readInteger(
      config,
      'CV_MEDIA_CLEANUP_BATCH_SIZE',
      1,
      100,
      DEFAULT_BATCH_SIZE,
    );
    const leaseMs =
      this.readInteger(
        config,
        'CV_MEDIA_CLEANUP_LEASE_SECONDS',
        10,
        1800,
        DEFAULT_LEASE_MS / 1000,
      ) * 1000;
    const retryBaseMs =
      this.readInteger(
        config,
        'CV_MEDIA_CLEANUP_RETRY_BASE_SECONDS',
        1,
        3600,
        DEFAULT_RETRY_BASE_MS / 1000,
      ) * 1000;
    const retryMaxMs =
      this.readInteger(
        config,
        'CV_MEDIA_CLEANUP_RETRY_MAX_SECONDS',
        1,
        86400,
        DEFAULT_RETRY_MAX_MS / 1000,
      ) * 1000;
    const mediaTimeoutMs = this.readInteger(
      config,
      'MEDIA_REQUEST_TIMEOUT_MS',
      100,
      10_000,
      3000,
    );
    if (
      retryMaxMs < retryBaseMs ||
      leaseMs < 2 * mediaTimeoutMs + 5000
    ) {
      throw new Error('CV Media cleanup configuration is invalid');
    }
    return {
      enabled,
      intervalMs,
      batchSize,
      leaseMs,
      retryBaseMs,
      retryMaxMs,
    };
  }

  private readBoolean(
    config: ConfigService,
    name: string,
    fallback: boolean,
  ): boolean {
    const value = config.get<unknown>(name);
    if (value === undefined || value === '') return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be true or false`);
  }

  private readInteger(
    config: ConfigService,
    name: string,
    minimum: number,
    maximum: number,
    fallback: number,
  ): number {
    const value = config.get<unknown>(name);
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new Error(`${name} must be an integer`);
    }
    const parsed = Number(value);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < minimum ||
      parsed > maximum
    ) {
      throw new Error(`${name} is outside its allowed range`);
    }
    return parsed;
  }
}
