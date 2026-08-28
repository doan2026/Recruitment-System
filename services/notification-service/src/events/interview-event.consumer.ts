import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InterviewEvent } from './interview-event';
import { InterviewEventProcessor } from './interview-event.processor';
import { ReliableEventConsumer } from './reliable-event.consumer';

@Injectable()
export class InterviewEventConsumer extends ReliableEventConsumer<InterviewEvent> {
  constructor(config: ConfigService, processor: InterviewEventProcessor) {
    const enabled =
      config.get<string>('NOTIFICATION_KAFKA_CONSUMER_ENABLED') === 'true';
    super(
      {
        enabled,
        brokers: enabled
          ? config
              .getOrThrow<string>('KAFKA_BROKERS')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        clientId: 'notification-service-interview-inbox',
        groupId:
          config.get<string>('KAFKA_NOTIFICATION_INTERVIEW_GROUP_ID') ??
          'notification-interview-inbox-v1',
        topic:
          config.get<string>('KAFKA_INTERVIEW_TOPIC') ?? 'interview-events',
        maxBytesPerPartition: Number(
          config.get<string>('NOTIFICATION_EVENT_MAX_BYTES') ?? '65536',
        ),
        loggerName: InterviewEventConsumer.name,
      },
      processor,
    );
  }
}
