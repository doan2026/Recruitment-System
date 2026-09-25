import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobService } from './job.service';

const DEFAULT_EXPIRY_INTERVAL_MS = 3_600_000;
const MIN_EXPIRY_INTERVAL_MS = 60_000;

/** Fails closed: a non-numeric value used to become NaN, i.e. a 1 ms timer. */
export function expiryIntervalMs(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_EXPIRY_INTERVAL_MS;
  }
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('JOB_EXPIRY_INTERVAL_MS must be a positive integer (milliseconds)');
  }
  return Math.max(value, MIN_EXPIRY_INTERVAL_MS);
}

@Injectable()
export class JobExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobExpiryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly jobs: JobService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = expiryIntervalMs(
      this.config.get<string>('JOB_EXPIRY_INTERVAL_MS'),
    );
    void this.expire();
    this.timer = setInterval(() => void this.expire(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async expire(): Promise<void> {
    try {
      const count = await this.jobs.expirePublishedJobs();
      if (count) this.logger.log(`Expired ${count} published job(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not expire published jobs: ${message}`);
    }
  }
}
