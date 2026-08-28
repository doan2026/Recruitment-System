import { isCanonicalUuid } from '../auth/jwt-verifier.service';
import { EventValidationError } from './event-processing';

export interface InterviewEvent {
  schemaVersion: 1;
  eventId: string;
  action: 'SCHEDULED';
  interviewId: string;
  applicationId: string;
  candidateId: string;
  interviewerId: string;
  actorId: string;
  roundNumber: number;
  scheduleRevision: number;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  status: 'SCHEDULED';
  aggregateVersion: number;
  occurredAt: Date;
}

const ALLOWED_KEYS = new Set([
  'schema_version',
  'event_id',
  'action',
  'interview_id',
  'application_id',
  'candidate_id',
  'interviewer_id',
  'actor_id',
  'round_number',
  'schedule_revision',
  'scheduled_start_at',
  'scheduled_end_at',
  'status',
  'aggregate_version',
  'occurred_at',
]);

export const parseInterviewEvent = (
  rawKey: Buffer | null,
  rawValue: Buffer | null,
  maxBytes: number,
): InterviewEvent => {
  if (!rawKey || rawKey.length === 0 || rawKey.length > 64) {
    throw new EventValidationError('EVENT_KEY_INVALID');
  }
  if (!rawValue || rawValue.length === 0) {
    throw new EventValidationError('EVENT_PAYLOAD_EMPTY');
  }
  if (rawValue.length > maxBytes) {
    throw new EventValidationError('EVENT_PAYLOAD_TOO_LARGE');
  }
  const key = rawKey.toString('utf8');
  if (!isCanonicalUuid(key)) {
    throw new EventValidationError('EVENT_KEY_INVALID');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawValue.toString('utf8')) as unknown;
  } catch {
    throw new EventValidationError('EVENT_JSON_INVALID');
  }
  if (!isRecord(payload) || Array.isArray(payload)) {
    throw new EventValidationError('EVENT_SHAPE_INVALID');
  }
  const keys = Object.keys(payload);
  if (
    keys.length !== ALLOWED_KEYS.size ||
    keys.some((name) => !ALLOWED_KEYS.has(name))
  ) {
    throw new EventValidationError('EVENT_FIELD_SET_INVALID');
  }
  if (payload.schema_version !== 1) {
    throw new EventValidationError('EVENT_SCHEMA_INVALID');
  }
  if (payload.action !== 'SCHEDULED' || payload.status !== 'SCHEDULED') {
    throw new EventValidationError('EVENT_ACTION_STATUS_INVALID');
  }

  const interviewId = requireUuid(
    payload.interview_id,
    'EVENT_INTERVIEW_ID_INVALID',
  );
  if (key !== interviewId) {
    throw new EventValidationError('EVENT_KEY_MISMATCH');
  }
  const interviewerId = requireUuid(
    payload.interviewer_id,
    'EVENT_INTERVIEWER_ID_INVALID',
  );
  const candidateId = requireUuid(
    payload.candidate_id,
    'EVENT_CANDIDATE_ID_INVALID',
  );
  if (candidateId === interviewerId) {
    throw new EventValidationError('EVENT_PARTICIPANTS_INVALID');
  }
  const actorId = requireUuid(payload.actor_id, 'EVENT_ACTOR_ID_INVALID');
  if (actorId !== interviewerId) {
    throw new EventValidationError('EVENT_ACTOR_INTERVIEWER_MISMATCH');
  }

  const roundNumber = requireInteger(
    payload.round_number,
    'EVENT_ROUND_INVALID',
  );
  if (roundNumber < 1 || roundNumber > 20) {
    throw new EventValidationError('EVENT_ROUND_INVALID');
  }
  const scheduleRevision = requirePositiveSafeInteger(
    payload.schedule_revision,
    'EVENT_SCHEDULE_REVISION_INVALID',
  );
  const aggregateVersion = requireNonNegativeSafeInteger(
    payload.aggregate_version,
    'EVENT_AGGREGATE_VERSION_INVALID',
  );
  const scheduledStartAt = requireInstant(
    payload.scheduled_start_at,
    'EVENT_SCHEDULED_START_INVALID',
  );
  const scheduledEndAt = requireInstant(
    payload.scheduled_end_at,
    'EVENT_SCHEDULED_END_INVALID',
  );
  if (scheduledEndAt <= scheduledStartAt) {
    throw new EventValidationError('EVENT_SCHEDULE_RANGE_INVALID');
  }

  return {
    schemaVersion: 1,
    eventId: requireUuidV4(payload.event_id, 'EVENT_ID_INVALID'),
    action: 'SCHEDULED',
    interviewId,
    applicationId: requireUuid(
      payload.application_id,
      'EVENT_APPLICATION_ID_INVALID',
    ),
    candidateId,
    interviewerId,
    actorId,
    roundNumber,
    scheduleRevision,
    scheduledStartAt,
    scheduledEndAt,
    status: 'SCHEDULED',
    aggregateVersion,
    occurredAt: requireInstant(
      payload.occurred_at,
      'EVENT_OCCURRED_AT_INVALID',
    ),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const requireUuid = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !isCanonicalUuid(value)) {
    throw new EventValidationError(code);
  }
  return value;
};

const requireUuidV4 = (value: unknown, code: string): string => {
  const result = requireUuid(value, code);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) {
    throw new EventValidationError(code);
  }
  return result;
};

const requireInteger = (value: unknown, code: string): number => {
  if (!Number.isInteger(value)) throw new EventValidationError(code);
  return value as number;
};

const requirePositiveSafeInteger = (value: unknown, code: string): number => {
  const result = requireInteger(value, code);
  if (result <= 0 || result > Number.MAX_SAFE_INTEGER) {
    throw new EventValidationError(code);
  }
  return result;
};

const requireNonNegativeSafeInteger = (
  value: unknown,
  code: string,
): number => {
  const result = requireInteger(value, code);
  if (result < 0 || result > Number.MAX_SAFE_INTEGER) {
    throw new EventValidationError(code);
  }
  return result;
};

const requireInstant = (value: unknown, code: string): Date => {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new EventValidationError(code);
  }
  const result = new Date(value);
  if (Number.isNaN(result.valueOf()) || result.toISOString() !== value) {
    throw new EventValidationError(code);
  }
  return result;
};
