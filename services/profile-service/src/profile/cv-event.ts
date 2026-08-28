import {
  Cv,
  CvEventAction,
  CvType,
} from '@prisma/client';

export const CV_EVENT_SCHEMA_VERSION = 1 as const;

export type CvEventPayload = Readonly<{
  readonly event_id: string;
  readonly action: CvEventAction;
  readonly cv_id: string;
  readonly candidate_id: string;
  readonly file_id: string;
  readonly cv_type: CvType;
  readonly occurred_at: string;
  readonly schema_version: typeof CV_EVENT_SCHEMA_VERSION;
  readonly aggregate_version: number;
}>;

export const CV_EVENT_PAYLOAD_FIELDS = Object.freeze([
  'event_id',
  'action',
  'cv_id',
  'candidate_id',
  'file_id',
  'cv_type',
  'occurred_at',
  'schema_version',
  'aggregate_version',
] as const satisfies readonly (keyof CvEventPayload)[]);

export function buildCvEvent(
  cv: Cv,
  action: CvEventAction,
  eventId: string,
  occurredAt = new Date(),
): CvEventPayload {
  if (
    !Number.isSafeInteger(cv.aggregateVersion) ||
    cv.aggregateVersion <= 0
  ) {
    throw new RangeError('CV aggregate version must be a positive integer');
  }
  if (Number.isNaN(occurredAt.getTime())) {
    throw new RangeError('CV event occurrence time must be valid');
  }
  if (cv.fileUrl !== null || cv.mediaReferenceId === null) {
    throw new Error('CV events require a private Media-backed CV');
  }
  if (
    (action === CvEventAction.UPSERTED && cv.isDeleted) ||
    (action !== CvEventAction.UPSERTED && !cv.isDeleted)
  ) {
    throw new Error(
      `CV event action ${action} is incompatible with deletion state`,
    );
  }

  return Object.freeze({
    event_id: eventId,
    action,
    cv_id: cv.id,
    candidate_id: cv.userId,
    file_id: cv.fileId,
    cv_type: cv.type,
    occurred_at: occurredAt.toISOString(),
    schema_version: CV_EVENT_SCHEMA_VERSION,
    aggregate_version: cv.aggregateVersion,
  });
}
