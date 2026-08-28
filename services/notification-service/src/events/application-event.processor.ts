import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApplicationEvent,
  parseApplicationEvent,
} from './application-event';
import { KafkaRecord } from './event-processing';
import { mapApplicationNotification } from './application-notification.mapper';
import { NotificationEventLedgerService } from './notification-event-ledger.service';

export { EventCollisionError, KafkaRecord } from './event-processing';

@Injectable()
export class ApplicationEventProcessor {
  private readonly maxBytes: number;
  private readonly replayAfterEpochMillis: number;

  constructor(
    private readonly ledger: NotificationEventLedgerService,
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
  ) {
    return this.ledger.process(
      record,
      {
        schemaVersion: event.schemaVersion,
        eventId: event.eventId,
        eventKey: event.applicationId,
      },
      () => {
        const draft = mapApplicationNotification(event);
        return draft ? [draft] : [];
      },
      this.replayAfterEpochMillis,
    );
  }

  async recordPoison(record: KafkaRecord, errorCode: string): Promise<void> {
    await this.ledger.recordPoison(record, errorCode);
  }
}
