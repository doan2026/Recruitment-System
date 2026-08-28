import { Injectable } from '@nestjs/common';
import {
  DeliveryChannel,
  DeliveryStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventCollisionError,
  KafkaRecord,
  NotificationDraft,
  NotificationSourceEvent,
} from './event-processing';

export type ProjectionResult =
  | 'CREATED'
  | 'DUPLICATE'
  | 'NO_RECIPIENT'
  | 'SKIPPED_BEFORE_REPLAY_CUTOFF';

@Injectable()
export class NotificationEventLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async process(
    record: KafkaRecord,
    event: NotificationSourceEvent,
    notificationFactory: () => NotificationDraft[],
    replayAfterEpochMillis: number,
  ): Promise<ProjectionResult> {
    const hash = sha256(record.value);
    const recordTimestamp = Number(record.timestamp);
    if (!Number.isSafeInteger(recordTimestamp) || recordTimestamp < 0) {
      throw new Error('Kafka record timestamp is invalid');
    }
    const beforeReplayCutoff = recordTimestamp < replayAfterEpochMillis;
    const drafts = beforeReplayCutoff
      ? []
      : uniqueRecipients(notificationFactory());

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.processedEvent.findUnique({
          where: {
            topic_eventId: {
              topic: record.topic,
              eventId: event.eventId,
            },
          },
        });
        if (existing) {
          if (
            existing.payloadSha256 !== hash ||
            existing.eventKey !== event.eventKey
          ) {
            throw new EventCollisionError();
          }
          return 'DUPLICATE' as const;
        }

        for (const draft of drafts) {
          const notification = await transaction.notification.create({
            data: {
              userId: draft.userId,
              type: draft.type,
              title: draft.title,
              body: draft.body,
              payloadJson: draft.payloadJson,
              sourceTopic: record.topic,
              sourceEventId: event.eventId,
            },
          });
          await transaction.notificationLog.create({
            data: {
              notificationId: notification.id,
              channel: DeliveryChannel.IN_APP,
              status: DeliveryStatus.SENT,
              attempt: 1,
              sentAt: new Date(),
            },
          });
        }
        await transaction.processedEvent.create({
          data: {
            topic: record.topic,
            eventId: event.eventId,
            eventKey: event.eventKey,
            payloadSha256: hash,
            schemaVersion: event.schemaVersion,
          },
        });
        if (beforeReplayCutoff) {
          return 'SKIPPED_BEFORE_REPLAY_CUTOFF' as const;
        }
        return drafts.length > 0
          ? ('CREATED' as const)
          : ('NO_RECIPIENT' as const);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.processedEvent.findUnique({
          where: {
            topic_eventId: {
              topic: record.topic,
              eventId: event.eventId,
            },
          },
        });
        if (!existing) {
          // A uniqueness failure outside the event ledger is not a durable
          // terminal outcome. Retry it without committing the Kafka offset.
          throw error;
        }
        if (
          existing.payloadSha256 === hash &&
          existing.eventKey === event.eventKey
        ) {
          return 'DUPLICATE';
        }
        throw new EventCollisionError();
      }
      throw error;
    }
  }

  async recordPoison(record: KafkaRecord, errorCode: string): Promise<void> {
    await this.prisma.poisonEvent.upsert({
      where: {
        topic_partition_offset: {
          topic: record.topic,
          partition: record.partition,
          offset: BigInt(record.offset),
        },
      },
      create: {
        topic: record.topic,
        partition: record.partition,
        offset: BigInt(record.offset),
        eventKeySha256: sha256(record.key),
        payloadSha256: sha256(record.value),
        errorCode,
      },
      update: {},
    });
  }
}

const uniqueRecipients = (drafts: NotificationDraft[]): NotificationDraft[] => {
  const recipients = new Set<string>();
  return drafts.filter((draft) => {
    if (recipients.has(draft.userId)) return false;
    recipients.add(draft.userId);
    return true;
  });
};

export const sha256 = (value: Buffer | null): string =>
  createHash('sha256').update(value ?? Buffer.alloc(0)).digest('hex');
