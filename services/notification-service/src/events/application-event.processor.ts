import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeliveryChannel,
  DeliveryStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplicationEvent,
  parseApplicationEvent,
} from './application-event';
import { mapApplicationNotification } from './application-notification.mapper';

export interface KafkaRecord {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
  key: Buffer | null;
  value: Buffer | null;
}

export class EventCollisionError extends Error {
  readonly code = 'EVENT_ID_COLLISION';
}

@Injectable()
export class ApplicationEventProcessor {
  private readonly maxBytes: number;
  private readonly replayAfterEpochMillis: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.maxBytes = Number(
      config.getOrThrow<string>('NOTIFICATION_EVENT_MAX_BYTES'),
    );
    this.replayAfterEpochMillis = new Date(
      config.get<string>('NOTIFICATION_APPLICATION_REPLAY_AFTER') ??
        '1970-01-01T00:00:00.000Z',
    ).valueOf();
  }

  parse(record: KafkaRecord): ApplicationEvent {
    return parseApplicationEvent(record.key, record.value, this.maxBytes);
  }

  async process(
    record: KafkaRecord,
    event: ApplicationEvent,
  ): Promise<
    | 'CREATED'
    | 'DUPLICATE'
    | 'NO_RECIPIENT'
    | 'SKIPPED_BEFORE_REPLAY_CUTOFF'
  > {
    const hash = sha256(record.value);
    const recordTimestamp = Number(record.timestamp);
    if (!Number.isSafeInteger(recordTimestamp) || recordTimestamp < 0) {
      throw new Error('Kafka record timestamp is invalid');
    }
    const beforeReplayCutoff =
      recordTimestamp < this.replayAfterEpochMillis;
    const draft = beforeReplayCutoff
      ? null
      : mapApplicationNotification(event);
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
            existing.eventKey !== event.applicationId
          ) {
            throw new EventCollisionError();
          }
          return 'DUPLICATE' as const;
        }

        if (draft) {
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
            eventKey: event.applicationId,
            payloadSha256: hash,
            schemaVersion: event.schemaVersion,
          },
        });
        if (beforeReplayCutoff) {
          return 'SKIPPED_BEFORE_REPLAY_CUTOFF' as const;
        }
        return draft ? ('CREATED' as const) : ('NO_RECIPIENT' as const);
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
        if (
          existing?.payloadSha256 === hash &&
          existing.eventKey === event.applicationId
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

export const sha256 = (value: Buffer | null): string =>
  createHash('sha256').update(value ?? Buffer.alloc(0)).digest('hex');
