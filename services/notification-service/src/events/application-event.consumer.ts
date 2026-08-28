import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, logLevel } from 'kafkajs';
import {
  ApplicationEventProcessor,
  EventCollisionError,
  KafkaRecord,
} from './application-event.processor';
import { EventValidationError } from './application-event';

@Injectable()
export class ApplicationEventConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ApplicationEventConsumer.name);
  private readonly enabled: boolean;
  private readonly topic: string;
  private readonly consumer: Consumer | null;
  private stopping = false;
  private connected = false;
  private subscribed = false;
  private starting = false;
  private reconnectDelayMs = 500;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    config: ConfigService,
    private readonly processor: ApplicationEventProcessor,
  ) {
    this.enabled =
      config.get<string>('NOTIFICATION_KAFKA_CONSUMER_ENABLED') === 'true';
    this.topic =
      config.get<string>('KAFKA_APPLICATION_TOPIC') ?? 'application-events';
    if (!this.enabled) {
      this.consumer = null;
      return;
    }
    const brokers = config
      .getOrThrow<string>('KAFKA_BROKERS')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const kafka = new Kafka({
      clientId: 'notification-service-application-inbox',
      brokers,
      logLevel: logLevel.WARN,
      retry: { retries: 8 },
    });
    this.consumer = kafka.consumer({
      groupId:
        config.get<string>('KAFKA_NOTIFICATION_GROUP_ID') ??
        'notification-application-inbox-v1',
      allowAutoTopicCreation: false,
      maxBytesPerPartition: Number(
        config.get<string>('NOTIFICATION_EVENT_MAX_BYTES') ?? '65536',
      ),
    });
    this.consumer.on(this.consumer.events.GROUP_JOIN, () => {
      this.connected = true;
      this.reconnectDelayMs = 500;
    });
    this.consumer.on(this.consumer.events.DISCONNECT, () => {
      this.connected = false;
    });
    this.consumer.on(this.consumer.events.STOP, () => {
      this.connected = false;
    });
    this.consumer.on(this.consumer.events.CRASH, ({ payload }) => {
      this.connected = false;
      if (!payload.restart) this.scheduleReconnect();
    });
  }

  onApplicationBootstrap(): void {
    this.startConsumer();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.consumer) {
      await this.consumer.stop().catch(() => undefined);
      await this.consumer.disconnect().catch(() => undefined);
    }
  }

  isReady(): boolean {
    return !this.enabled || this.connected;
  }

  private startConsumer(): void {
    if (!this.consumer || this.stopping || this.starting) return;
    this.starting = true;
    void this.connectAndRun().finally(() => {
      this.starting = false;
    });
  }

  private async connectAndRun(): Promise<void> {
    if (!this.consumer) return;
    try {
      await this.consumer.connect();
      if (!this.subscribed) {
        await this.consumer.subscribe({
          topic: this.topic,
          // This is a dedicated v1 projection group. Replaying the retained
          // topic on its first join prevents startup order from losing events;
          // ProcessedEvent makes subsequent delivery idempotent.
          fromBeginning: true,
        });
        this.subscribed = true;
      }
      await this.consumer.run({
        autoCommit: false,
        eachBatchAutoResolve: false,
        eachBatch: async ({ batch, heartbeat, isRunning, isStale }) => {
          for (const message of batch.messages) {
            if (!isRunning() || isStale() || this.stopping) break;
            const record: KafkaRecord = {
              topic: batch.topic,
              partition: batch.partition,
              offset: message.offset,
              key: message.key,
              value: message.value,
            };
            try {
              const event = this.processor.parse(record);
              await this.processor.process(record, event);
            } catch (error) {
              if (
                error instanceof EventValidationError ||
                error instanceof EventCollisionError
              ) {
                await this.processor.recordPoison(record, error.code);
                this.logger.warn(
                  `Quarantined ${batch.topic} partition ${batch.partition} offset ${message.offset}: ${error.code}`,
                );
              } else {
                throw error;
              }
            }
            await this.consumer!.commitOffsets([
              {
                topic: batch.topic,
                partition: batch.partition,
                offset: (BigInt(message.offset) + 1n).toString(),
              },
            ]);
            await heartbeat();
          }
        },
      });
    } catch (error) {
      this.connected = false;
      if (this.stopping) return;
      this.logger.error(
        'Application event consumer failed to start; retrying without committing any offset',
        error instanceof Error ? error.stack : undefined,
      );
      await this.consumer.disconnect().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    const delayMs = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delayMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startConsumer();
    }, delayMs);
  }
}
