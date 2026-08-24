import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobService } from './job.service';

@Injectable()
export class JobExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobExpiryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly jobs: JobService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const configured = this.config.get<number>('JOB_EXPIRY_INTERVAL_MS');
    const intervalMs = Math.max(configured ?? 3_600_000, 60_000);
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
