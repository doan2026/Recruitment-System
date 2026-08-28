import { Prisma } from '@prisma/client';

export interface KafkaRecord {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
  key: Buffer | null;
  value: Buffer | null;
}

export interface NotificationSourceEvent {
  schemaVersion: number | null;
  eventId: string;
  eventKey: string;
}

export interface NotificationDraft {
  userId: string;
  type: Prisma.NotificationCreateInput['type'];
  title: string;
  body: string;
  payloadJson: Prisma.InputJsonObject;
}

export class EventValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class EventCollisionError extends Error {
  readonly code = 'EVENT_ID_COLLISION';
}
