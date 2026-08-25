import {
  Job,
  JobEventAction,
  JobStatus,
  JobType,
} from '@prisma/client';

export const JOB_EVENT_SCHEMA_VERSION = 1 as const;

export type JobEventPayload = Readonly<{
  readonly event_id: string;
  readonly action: JobEventAction;
  readonly job_id: string;
  readonly company_id: string;
  readonly title: string;
  readonly description: string;
  readonly skills: readonly string[];
  readonly location: string;
  readonly status: JobStatus;
  readonly occurred_at: string;
  readonly schema_version: typeof JOB_EVENT_SCHEMA_VERSION;
  readonly aggregate_version: number;
  readonly requirements: string;
  readonly salary_min: string | null;
  readonly salary_max: string | null;
  readonly job_type: JobType;
}>;

export const JOB_EVENT_PAYLOAD_FIELDS = Object.freeze([
  'event_id',
  'action',
  'job_id',
  'company_id',
  'title',
  'description',
  'skills',
  'location',
  'status',
  'occurred_at',
  'schema_version',
  'aggregate_version',
  'requirements',
  'salary_min',
  'salary_max',
  'job_type',
] as const satisfies readonly (keyof JobEventPayload)[]);

const ALLOWED_STATUSES: Readonly<
  Record<JobEventAction, ReadonlySet<JobStatus>>
> = {
  [JobEventAction.CREATED]: new Set([JobStatus.DRAFT]),
  [JobEventAction.UPDATED]: new Set([
    JobStatus.DRAFT,
    JobStatus.PENDING_APPROVAL,
    JobStatus.PUBLISHED,
  ]),
  [JobEventAction.CLOSED]: new Set([JobStatus.CLOSED]),
  [JobEventAction.EXPIRED]: new Set([JobStatus.EXPIRED]),
};

export function buildJobEvent(
  job: Job,
  action: JobEventAction,
  eventId: string,
  occurredAt = new Date(),
): Readonly<JobEventPayload> {
  if (
    !Number.isSafeInteger(job.aggregateVersion) ||
    job.aggregateVersion <= 0
  ) {
    throw new RangeError('Job aggregate version must be a positive integer');
  }
  if (!ALLOWED_STATUSES[action].has(job.status)) {
    throw new Error(
      'Job event action ' + action +
        ' is incompatible with status ' + job.status,
    );
  }
  if (Number.isNaN(occurredAt.getTime())) {
    throw new RangeError('Job event occurrence time must be valid');
  }

  return Object.freeze({
    event_id: eventId,
    action,
    job_id: job.id,
    company_id: job.companyId,
    title: job.title,
    description: job.description,
    skills: Object.freeze([...job.skills]),
    location: job.location,
    status: job.status,
    occurred_at: occurredAt.toISOString(),
    schema_version: JOB_EVENT_SCHEMA_VERSION,
    aggregate_version: job.aggregateVersion,
    requirements: job.requirements,
    salary_min: job.salaryMin?.toFixed(2) ?? null,
    salary_max: job.salaryMax?.toFixed(2) ?? null,
    job_type: job.jobType,
  });
}
