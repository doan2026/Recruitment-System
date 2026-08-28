import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationEvent } from './application-event';
import { ApplicationEventProcessor } from './application-event.processor';
import { ReliableEventConsumer } from './reliable-event.consumer';

@Injectable()
export class ApplicationEventConsumer extends ReliableEventConsumer<ApplicationEvent> {
  constructor(config: ConfigService, processor: ApplicationEventProcessor) {
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
        clientId: 'notification-service-application-inbox',
        groupId:
          config.get<string>('KAFKA_NOTIFICATION_GROUP_ID') ??
          'notification-application-inbox-v1',
        topic:
          config.get<string>('KAFKA_APPLICATION_TOPIC') ??
          'application-events',
        maxBytesPerPartition: Number(
          config.get<string>('NOTIFICATION_EVENT_MAX_BYTES') ?? '65536',
        ),
        loggerName: ApplicationEventConsumer.name,
      },
      processor,
    );
  }
}
