import {
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Consumer, Kafka, logLevel } from 'kafkajs';
import {
  EventCollisionError,
  EventValidationError,
  KafkaRecord,
} from './event-processing';

export interface KafkaEventProcessor<T> {
  parse(record: KafkaRecord): T;
  process(record: KafkaRecord, event: T): Promise<unknown>;
  recordPoison(record: KafkaRecord, errorCode: string): Promise<void>;
}

export interface ReliableEventConsumerOptions {
  enabled: boolean;
  brokers: string[];
  clientId: string;
  groupId: string;
  topic: string;
  maxBytesPerPartition: number;
  loggerName: string;
}

export class ReliableEventConsumer<T>
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger: Logger;
  private readonly consumer: Consumer | null;
  private stopping = false;
  private connected = false;
  private subscribed = false;
  private starting = false;
  private reconnectDelayMs = 500;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: ReliableEventConsumerOptions,
    private readonly processor: KafkaEventProcessor<T>,
  ) {
    this.logger = new Logger(options.loggerName);
    if (!options.enabled) {
      this.consumer = null;
      return;
    }
    const kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.brokers,
      logLevel: logLevel.WARN,
      retry: { retries: 8 },
    });
    this.consumer = kafka.consumer({
      groupId: options.groupId,
      allowAutoTopicCreation: false,
      maxBytesPerPartition: options.maxBytesPerPartition,
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
    return !this.options.enabled || this.connected;
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
          topic: this.options.topic,
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
              timestamp: message.timestamp,
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
        `${this.options.topic} consumer failed to start; retrying without committing any offset`,
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
