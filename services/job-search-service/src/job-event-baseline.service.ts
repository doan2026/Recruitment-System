import { Injectable } from '@nestjs/common';
import { Job, JobEventAction, JobStatus, Prisma } from '@prisma/client';
import { JobEventPublisherService } from './job-event-publisher.service';
import { PrismaService } from './prisma.service';

export const JOB_EVENT_BASELINE_BATCH_SIZE_DEFAULT = 100;
export const JOB_EVENT_BASELINE_BATCH_SIZE_MINIMUM = 1;
export const JOB_EVENT_BASELINE_BATCH_SIZE_MAXIMUM = 500;
export const JOB_EVENT_BASELINE_MAX_BATCHES_DEFAULT = 1;
export const JOB_EVENT_BASELINE_MAX_BATCHES_MINIMUM = 1;
export const JOB_EVENT_BASELINE_MAX_BATCHES_MAXIMUM = 10_000;

export interface JobEventBaselineOptions {
  execute: boolean;
  batchSize: number;
  maxBatches: number;
  now?: Date;
}

export interface JobEventBaselineResult {
  totalJobs: number;
  stalePublishedJobs: number;
  missingCurrentEventsBefore: number;
  selectedJobs: number;
  insertedEvents: number;
  processedBatches: number;
  remainingCurrentEvents: number;
  pendingOutboxEvents: number;
}

interface BaselineInspection {
  totalJobs: number;
  stalePublishedJobs: number;
  missingCurrentEvents: number;
  pendingOutboxEvents: number;
}

interface BaselineInspectionRow {
  totalJobs: bigint | number | string;
  stalePublishedJobs: bigint | number | string;
  missingCurrentEvents: bigint | number | string;
  pendingOutboxEvents: bigint | number | string;
}

interface BaselineBatchResult {
  selected: number;
  inserted: number;
}

@Injectable()
export class JobEventBaselineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: JobEventPublisherService,
  ) {}

  async run(options: JobEventBaselineOptions): Promise<JobEventBaselineResult> {
    validateOptions(options);
    const now = options.now ?? new Date();
    const utcDate = now.toISOString().slice(0, 10);
    const before = await this.inspect(utcDate);

    if (!options.execute || before.stalePublishedJobs > 0) {
      return result(before, before, 0, 0, 0);
    }

    let selectedJobs = 0;
    let insertedEvents = 0;
    let processedBatches = 0;
    for (let batch = 0; batch < options.maxBatches; batch += 1) {
      const current = await this.appendBatch(options.batchSize);
      if (current.selected === 0) break;
      processedBatches += 1;
      selectedJobs += current.selected;
      insertedEvents += current.inserted;
    }

    const after = await this.inspect(utcDate);
    return result(
      before,
      after,
      selectedJobs,
      insertedEvents,
      processedBatches,
    );
  }

  private async inspect(utcDate: string): Promise<BaselineInspection> {
    const rows = await this.prisma.$queryRaw<BaselineInspectionRow[]>`
      SELECT
        COUNT(*)::bigint AS "totalJobs",
        COUNT(*) FILTER (
          WHERE source."status" = 'PUBLISHED'::"job"."JobStatus"
            AND source."deadline" < ${utcDate}::date
        )::bigint AS "stalePublishedJobs",
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM "job"."job_event_outbox" AS current_event
            WHERE current_event."job_id" = source."id"
              AND current_event."aggregate_version" =
                source."aggregate_version"
          )
        )::bigint AS "missingCurrentEvents",
        (
          SELECT COUNT(*)::bigint
          FROM "job"."job_event_outbox" AS pending
          WHERE pending."published_at" IS NULL
        ) AS "pendingOutboxEvents"
      FROM "job"."jobs" AS source
    `;
    const row = rows[0];
    if (!row) throw new Error('JOB_EVENT_BASELINE_INSPECTION_FAILED');
    return {
      totalJobs: safeCount(row.totalJobs),
      stalePublishedJobs: safeCount(row.stalePublishedJobs),
      missingCurrentEvents: safeCount(row.missingCurrentEvents),
      pendingOutboxEvents: safeCount(row.pendingOutboxEvents),
    };
  }

  private appendBatch(batchSize: number): Promise<BaselineBatchResult> {
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT source."id"
        FROM "job"."jobs" AS source
        WHERE NOT EXISTS (
          SELECT 1
          FROM "job"."job_event_outbox" AS current_event
          WHERE current_event."job_id" = source."id"
            AND current_event."aggregate_version" =
              source."aggregate_version"
        )
        ORDER BY source."id"
        FOR UPDATE OF source SKIP LOCKED
        LIMIT ${batchSize}
      `;
      if (!candidates.length) return { selected: 0, inserted: 0 };

      const jobs = await transaction.job.findMany({
        where: { id: { in: candidates.map(({ id }) => id) } },
      });
      const jobsById = new Map(jobs.map((job) => [job.id, job]));
      let inserted = 0;
      for (const candidate of candidates) {
        const job = jobsById.get(candidate.id);
        if (!job) throw new Error('JOB_EVENT_BASELINE_SOURCE_DISAPPEARED');
        const eventId = await this.events.appendBaselineSnapshot(
          transaction,
          job,
          baselineAction(job),
        );
        if (eventId !== null) inserted += 1;
      }
      return { selected: candidates.length, inserted };
    });
  }
}

export function baselineAction(
  job: Pick<Job, 'status'>,
): JobEventAction {
  switch (job.status) {
    case JobStatus.DRAFT:
    case JobStatus.PENDING_APPROVAL:
    case JobStatus.PUBLISHED:
      return JobEventAction.UPDATED;
    case JobStatus.CLOSED:
      return JobEventAction.CLOSED;
    case JobStatus.EXPIRED:
      return JobEventAction.EXPIRED;
  }
}

function validateOptions(options: JobEventBaselineOptions): void {
  if (typeof options.execute !== 'boolean') {
    throw new Error('execute must be a boolean');
  }
  boundedInteger(
    options.batchSize,
    'batchSize',
    JOB_EVENT_BASELINE_BATCH_SIZE_MINIMUM,
    JOB_EVENT_BASELINE_BATCH_SIZE_MAXIMUM,
  );
  boundedInteger(
    options.maxBatches,
    'maxBatches',
    JOB_EVENT_BASELINE_MAX_BATCHES_MINIMUM,
    JOB_EVENT_BASELINE_MAX_BATCHES_MAXIMUM,
  );
  if (options.now && Number.isNaN(options.now.getTime())) {
    throw new Error('now must be a valid date');
  }
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function safeCount(value: bigint | number | string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('JOB_EVENT_BASELINE_COUNT_OUT_OF_RANGE');
  }
  return count;
}

function result(
  before: BaselineInspection,
  after: BaselineInspection,
  selectedJobs: number,
  insertedEvents: number,
  processedBatches: number,
): JobEventBaselineResult {
  return {
    totalJobs: after.totalJobs,
    stalePublishedJobs: after.stalePublishedJobs,
    missingCurrentEventsBefore: before.missingCurrentEvents,
    selectedJobs,
    insertedEvents,
    processedBatches,
    remainingCurrentEvents: after.missingCurrentEvents,
    pendingOutboxEvents: after.pendingOutboxEvents,
  };
}
