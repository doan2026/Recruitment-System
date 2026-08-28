import {
  Controller,
  Get,
  HttpStatus,
} from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { Public } from '../auth/public.decorator';
import { ApplicationEventConsumer } from '../events/application-event.consumer';
import { InterviewEventConsumer } from '../events/interview-event.consumer';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applicationConsumer: ApplicationEventConsumer,
    private readonly interviewConsumer: InterviewEventConsumer,
  ) {}

  @Get()
  live() {
    return { service: 'notification-service', status: 'UP' };
  }

  @Get('live')
  liveness() {
    return { service: 'notification-service', status: 'UP' };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw unavailable('DATABASE_UNAVAILABLE');
    }
    if (!this.applicationConsumer.isReady()) {
      throw unavailable('APPLICATION_EVENT_CONSUMER_NOT_READY');
    }
    if (!this.interviewConsumer.isReady()) {
      throw unavailable('INTERVIEW_EVENT_CONSUMER_NOT_READY');
    }
    return {
      service: 'notification-service',
      status: 'UP',
      database: 'UP',
      applicationEventConsumer: 'UP',
      interviewEventConsumer: 'UP',
    };
  }
}

const unavailable = (reason: string): ApiException =>
  new ApiException(
    'SERVICE_NOT_READY',
    'Notification Service is not ready',
    HttpStatus.SERVICE_UNAVAILABLE,
    { reason },
  );
