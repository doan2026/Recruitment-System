import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaRecord } from './event-processing';
import { InterviewEvent, parseInterviewEvent } from './interview-event';
import { mapInterviewNotifications } from './interview-notification.mapper';
import { NotificationEventLedgerService } from './notification-event-ledger.service';

@Injectable()
export class InterviewEventProcessor {
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
      config.get<string>('NOTIFICATION_INTERVIEW_REPLAY_AFTER') ??
        '1970-01-01T00:00:00.000Z',
    ).valueOf();
  }

  parse(record: KafkaRecord): InterviewEvent {
    return parseInterviewEvent(record.key, record.value, this.maxBytes);
  }

  process(record: KafkaRecord, event: InterviewEvent) {
    return this.ledger.process(
      record,
      {
        schemaVersion: event.schemaVersion,
        eventId: event.eventId,
        eventKey: event.interviewId,
      },
      () => mapInterviewNotifications(event),
      this.replayAfterEpochMillis,
    );
  }

  recordPoison(record: KafkaRecord, errorCode: string): Promise<void> {
    return this.ledger.recordPoison(record, errorCode);
  }
}
