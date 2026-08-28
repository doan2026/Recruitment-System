import { Injectable } from '@nestjs/common';
import {
  CvEventAction,
  Prisma,
} from '@prisma/client';
import {
  ProfileMediaClient,
  ProfileMediaType,
} from '../media/profile-media.client';
import { PrismaService } from '../prisma/prisma.service';
import { CvEventPublisherService } from './cv-event-publisher.service';

export const CV_EVENT_BASELINE_DEFAULT_BATCH_SIZE = 25;
export const CV_EVENT_BASELINE_MAX_BATCH_SIZE = 100;
export const CV_EVENT_BASELINE_DEFAULT_MAX_BATCHES = 1;
export const CV_EVENT_BASELINE_MAX_BATCHES = 100;

export interface CvEventBaselineOptions {
  readonly execute: boolean;
  readonly batchSize: number;
  readonly maxBatches: number;
}

export interface CvEventBaselineSummary {
  readonly activeLegacyCvCount: number;
  readonly batchesProcessed: number;
  readonly candidatesScanned: number;
  readonly mediaVerified: number;
  readonly mediaErrors: number;
  readonly eventsAppended: number;
  readonly concurrentlyCovered: number;
  readonly stateChanged: number;
  readonly eligibleRemaining: number;
}

interface BaselineCandidate {
  readonly cvId: string;
  readonly userId: string;
  readonly fileId: string;
  readonly createdAt: Date;
}

interface BaselineCursor {
  readonly cvId: string;
  readonly createdAt: Date;
}

enum BaselineMutationOutcome {
  APPENDED = 'APPENDED',
  COVERED = 'COVERED',
  STATE_CHANGED = 'STATE_CHANGED',
}

type Transaction = Prisma.TransactionClient;

const ELIGIBLE_CV_PREDICATE = Prisma.sql`
  NOT cv."is_deleted"
  AND cv."file_url" IS NULL
  AND cv."media_reference_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "profile"."cv_deletion_workflow" AS deletion
    WHERE deletion."cv_id" = cv."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "profile"."cvs" AS successor
    WHERE successor."previous_revision_id" = cv."id"
       OR (
         successor."revision_series_id" = cv."id"
         AND successor."id" <> cv."id"
       )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "profile"."cv_event_outbox" AS event
    WHERE event."cv_id" = cv."id"
  )
`;

@Injectable()
export class CvEventBaselineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: ProfileMediaClient,
    private readonly events: CvEventPublisherService,
  ) {}

  async run(
    options: CvEventBaselineOptions,
  ): Promise<CvEventBaselineSummary> {
    this.assertOptions(options);
    const counters = {
      activeLegacyCvCount: await this.countActiveLegacyCvs(),
      batchesProcessed: 0,
      candidatesScanned: 0,
      mediaVerified: 0,
      mediaErrors: 0,
      eventsAppended: 0,
      concurrentlyCovered: 0,
      stateChanged: 0,
      eligibleRemaining: 0,
    };
    let cursor: BaselineCursor | undefined;

    for (
      let batchNumber = 0;
      batchNumber < options.maxBatches;
      batchNumber += 1
    ) {
      const candidates = await this.listCandidates(
        options.batchSize,
        cursor,
      );
      if (candidates.length === 0) break;

      counters.batchesProcessed += 1;
      counters.candidatesScanned += candidates.length;
      for (const candidate of candidates) {
        try {
          await this.media.verifyUserFile(
            candidate.fileId,
            candidate.userId,
            ProfileMediaType.CV,
          );
          counters.mediaVerified += 1;
        } catch {
          counters.mediaErrors += 1;
          continue;
        }

        if (!options.execute) continue;
        const outcome = await this.appendIfStillEligible(candidate);
        if (outcome === BaselineMutationOutcome.APPENDED) {
          counters.eventsAppended += 1;
        } else if (outcome === BaselineMutationOutcome.COVERED) {
          counters.concurrentlyCovered += 1;
        } else {
          counters.stateChanged += 1;
        }
      }

      const last = candidates[candidates.length - 1];
      cursor = { cvId: last.cvId, createdAt: last.createdAt };
      if (candidates.length < options.batchSize) break;
    }

    counters.eligibleRemaining = await this.countEligibleCvs();
    if (counters.eventsAppended > 0) this.events.wake();
    return counters;
  }

  private async listCandidates(
    limit: number,
    cursor?: BaselineCursor,
  ): Promise<BaselineCandidate[]> {
    const cursorFilter = cursor
      ? Prisma.sql`
          AND (cv."created_at", cv."id") >
            (${cursor.createdAt}, ${cursor.cvId}::uuid)
        `
      : Prisma.empty;
    return this.prisma.$queryRaw<BaselineCandidate[]>(Prisma.sql`
      SELECT
        cv."id"::text AS "cvId",
        cv."user_id"::text AS "userId",
        cv."file_id"::text AS "fileId",
        cv."created_at" AS "createdAt"
      FROM "profile"."cvs" AS cv
      WHERE ${ELIGIBLE_CV_PREDICATE}
      ${cursorFilter}
      ORDER BY cv."created_at", cv."id"
      LIMIT ${limit}
    `);
  }

  private async countEligibleCvs(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT count(*) AS "count"
        FROM "profile"."cvs" AS cv
        WHERE ${ELIGIBLE_CV_PREDICATE}
      `,
    );
    return this.safeCount(rows[0]?.count);
  }

  private async countActiveLegacyCvs(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT count(*) AS "count"
        FROM "profile"."cvs" AS cv
        WHERE NOT cv."is_deleted"
          AND cv."file_url" IS NOT NULL
          AND cv."media_reference_id" IS NULL
      `,
    );
    return this.safeCount(rows[0]?.count);
  }

  private async appendIfStillEligible(
    candidate: BaselineCandidate,
  ): Promise<BaselineMutationOutcome> {
    return this.runSerializable(async (transaction) => {
      const profiles = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT profile."id"::text AS "id"
          FROM "profile"."profiles" AS profile
          WHERE profile."user_id" = ${candidate.userId}::uuid
          FOR UPDATE
        `,
      );
      if (!profiles[0]) return BaselineMutationOutcome.STATE_CHANGED;

      const lockedCvs = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT cv."id"::text AS "id"
          FROM "profile"."cvs" AS cv
          WHERE cv."id" = ${candidate.cvId}::uuid
          FOR UPDATE
        `,
      );
      if (!lockedCvs[0]) return BaselineMutationOutcome.STATE_CHANGED;

      const cv = await transaction.cv.findUnique({
        where: { id: candidate.cvId },
      });
      if (
        !cv ||
        cv.userId !== candidate.userId ||
        cv.fileId !== candidate.fileId ||
        cv.isDeleted ||
        cv.fileUrl !== null ||
        cv.mediaReferenceId === null
      ) {
        return BaselineMutationOutcome.STATE_CHANGED;
      }

      const deletion = await transaction.cvDeletionWorkflow.findUnique({
        where: { cvId: cv.id },
        select: { cvId: true },
      });
      if (deletion) return BaselineMutationOutcome.STATE_CHANGED;

      const successors = await transaction.cv.count({
        where: {
          OR: [
            { previousRevisionId: cv.id },
            {
              revisionSeriesId: cv.id,
              id: { not: cv.id },
            },
          ],
        },
      });
      if (successors > 0) return BaselineMutationOutcome.STATE_CHANGED;

      const existingEvent = await transaction.cvEventOutbox.findFirst({
        where: { cvId: cv.id },
        select: { id: true },
      });
      if (existingEvent) return BaselineMutationOutcome.COVERED;

      await this.events.append(
        transaction,
        cv,
        CvEventAction.UPSERTED,
      );
      return BaselineMutationOutcome.APPENDED;
    });
  }

  private async runSerializable<T>(
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        if (attempt >= maxAttempts || !this.isRetryable(error)) throw error;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, Math.min(10 * 2 ** (attempt - 1), 250));
        });
      }
    }
    throw new Error('CV event baseline transaction retry exhausted');
  }

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code === 'P2034') return true;
    if (
      error.code === 'P2010' &&
      String(error.meta?.code ?? '') === '40001'
    ) {
      return true;
    }
    if (error.code !== 'P2002') return false;
    const target = JSON.stringify(error.meta?.target ?? '');
    return target.includes('cv_id') && target.includes('aggregate_version');
  }

  private safeCount(value: bigint | undefined): number {
    const count = Number(value ?? 0n);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('CV event baseline count is outside the safe range');
    }
    return count;
  }

  private assertOptions(options: CvEventBaselineOptions): void {
    if (
      typeof options.execute !== 'boolean' ||
      !Number.isInteger(options.batchSize) ||
      options.batchSize < 1 ||
      options.batchSize > CV_EVENT_BASELINE_MAX_BATCH_SIZE ||
      !Number.isInteger(options.maxBatches) ||
      options.maxBatches < 1 ||
      options.maxBatches > CV_EVENT_BASELINE_MAX_BATCHES
    ) {
      throw new Error('CV event baseline options are invalid');
    }
  }
}
