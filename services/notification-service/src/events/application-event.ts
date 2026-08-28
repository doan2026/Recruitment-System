import { isCanonicalUuid } from '../auth/jwt-verifier.service';

export const APPLICATION_STATUSES = [
  'APPLIED',
  'REVIEWING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type ApplicationEventAction = 'STATUS_CHANGED' | 'OFFER_SENT';

export interface ApplicationEvent {
  schemaVersion: 1 | null;
  aggregateVersion: number | null;
  eventId: string;
  action: ApplicationEventAction;
  applicationId: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  recruiterId: string;
  actorId: string | null;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  occurredAt: Date;
  offerId: string | null;
  offerStatus: 'SENT' | 'ACCEPTED' | 'DECLINED' | null;
  offerVersion: number | null;
}

export class EventValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const ALLOWED_KEYS = new Set([
  'schema_version',
  'aggregate_version',
  'event_id',
  'action',
  'application_id',
  'job_id',
  'job_title',
  'candidate_id',
  'recruiter_id',
  'actor_id',
  'from_status',
  'to_status',
  'occurred_at',
  'offer_id',
  'offer_status',
  'offer_version',
]);

const OFFER_KEYS = ['offer_id', 'offer_status', 'offer_version'] as const;

export const parseApplicationEvent = (
  rawKey: Buffer | null,
  rawValue: Buffer | null,
  maxBytes: number,
): ApplicationEvent => {
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
  if (Object.keys(payload).some((name) => !ALLOWED_KEYS.has(name))) {
    throw new EventValidationError('EVENT_FIELD_UNKNOWN');
  }

  const schemaVersion =
    payload.schema_version === undefined
      ? null
      : requireInteger(payload.schema_version, 'EVENT_SCHEMA_INVALID');
  if (schemaVersion !== null && schemaVersion !== 1) {
    throw new EventValidationError('EVENT_SCHEMA_UNSUPPORTED');
  }
  const aggregateVersion =
    payload.aggregate_version === undefined
      ? null
      : requireNonNegativeInteger(
          payload.aggregate_version,
          'EVENT_AGGREGATE_VERSION_INVALID',
        );
  if (schemaVersion === 1 && aggregateVersion === null) {
    throw new EventValidationError('EVENT_AGGREGATE_VERSION_MISSING');
  }
  if (
    schemaVersion === 1 &&
    OFFER_KEYS.some(
      (name) =>
        Object.prototype.hasOwnProperty.call(payload, name) &&
        payload[name] === null,
    )
  ) {
    throw new EventValidationError('EVENT_OFFER_FIELDS_INVALID');
  }

  const applicationId = requireUuid(
    payload.application_id,
    'EVENT_APPLICATION_ID_INVALID',
  );
  if (key !== applicationId) {
    throw new EventValidationError('EVENT_KEY_MISMATCH');
  }
  const action = requireEnum(
    payload.action,
    ['STATUS_CHANGED', 'OFFER_SENT'] as const,
    'EVENT_ACTION_INVALID',
  );
  const actorId =
    payload.actor_id === null || payload.actor_id === undefined
      ? null
      : requireUuid(payload.actor_id, 'EVENT_ACTOR_ID_INVALID');
  if (schemaVersion === 1 && payload.actor_id === undefined) {
    throw new EventValidationError('EVENT_ACTOR_ID_MISSING');
  }
  const fromStatus =
    payload.from_status === null
      ? null
      : requireEnum(
          payload.from_status,
          APPLICATION_STATUSES,
          'EVENT_FROM_STATUS_INVALID',
        );
  const toStatus = requireEnum(
    payload.to_status,
    APPLICATION_STATUSES,
    'EVENT_TO_STATUS_INVALID',
  );
  const offerId =
    payload.offer_id === null || payload.offer_id === undefined
      ? null
      : requireUuid(payload.offer_id, 'EVENT_OFFER_ID_INVALID');
  const offerStatus =
    payload.offer_status === null || payload.offer_status === undefined
      ? null
      : requireEnum(
          payload.offer_status,
          ['SENT', 'ACCEPTED', 'DECLINED'] as const,
          'EVENT_OFFER_STATUS_INVALID',
        );
  const offerVersion =
    payload.offer_version === null || payload.offer_version === undefined
      ? null
      : requireNonNegativeInteger(
          payload.offer_version,
          'EVENT_OFFER_VERSION_INVALID',
        );
  if (
    action === 'OFFER_SENT' &&
    (!offerId ||
      offerStatus !== 'SENT' ||
      offerVersion === null ||
      fromStatus !== 'INTERVIEW' ||
      toStatus !== 'OFFER')
  ) {
    throw new EventValidationError('EVENT_OFFER_FIELDS_INVALID');
  }
  if (
    [offerId, offerStatus, offerVersion].filter((value) => value !== null)
      .length !== 0 &&
    [offerId, offerStatus, offerVersion].filter((value) => value !== null)
      .length !== 3
  ) {
    throw new EventValidationError('EVENT_OFFER_FIELDS_INVALID');
  }
  if (
    action === 'STATUS_CHANGED' &&
    offerId &&
    (fromStatus !== 'OFFER' ||
      !(
        (offerStatus === 'ACCEPTED' && toStatus === 'HIRED') ||
        (offerStatus === 'DECLINED' && toStatus === 'REJECTED')
      ))
  ) {
    throw new EventValidationError('EVENT_OFFER_FIELDS_INVALID');
  }

  return {
    schemaVersion: schemaVersion as 1 | null,
    aggregateVersion,
    eventId: requireUuid(payload.event_id, 'EVENT_ID_INVALID'),
    action,
    applicationId,
    jobId: requireUuid(payload.job_id, 'EVENT_JOB_ID_INVALID'),
    jobTitle: requireText(payload.job_title, 200, 'EVENT_JOB_TITLE_INVALID'),
    candidateId: requireUuid(
      payload.candidate_id,
      'EVENT_CANDIDATE_ID_INVALID',
    ),
    recruiterId: requireUuid(
      payload.recruiter_id,
      'EVENT_RECRUITER_ID_INVALID',
    ),
    actorId,
    fromStatus,
    toStatus,
    occurredAt: requireInstant(payload.occurred_at),
    offerId,
    offerStatus,
    offerVersion,
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

const requireText = (
  value: unknown,
  maxLength: number,
  code: string,
): string => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new EventValidationError(code);
  }
  return value;
};

const requireInteger = (value: unknown, code: string): number => {
  if (!Number.isInteger(value)) throw new EventValidationError(code);
  return value as number;
};

const requireNonNegativeInteger = (
  value: unknown,
  code: string,
): number => {
  const result = requireInteger(value, code);
  if (result < 0 || result > Number.MAX_SAFE_INTEGER) {
    throw new EventValidationError(code);
  }
  return result;
};

const requireEnum = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
  code: string,
): T[number] => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new EventValidationError(code);
  }
  return value as T[number];
};

const requireInstant = (value: unknown): Date => {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  ) {
    throw new EventValidationError('EVENT_OCCURRED_AT_INVALID');
  }
  const result = new Date(value);
  if (Number.isNaN(result.valueOf())) {
    throw new EventValidationError('EVENT_OCCURRED_AT_INVALID');
  }
  return result;
};
