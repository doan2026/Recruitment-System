import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { JwtVerifierService } from './auth/jwt-verifier.service';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { NoStoreInterceptor } from './common/no-store.interceptor';
import { validateEnvironment } from './config/environment';
import { ApplicationEventConsumer } from './events/application-event.consumer';
import { ApplicationEventProcessor } from './events/application-event.processor';
import { HealthController } from './health/health.controller';
import { NotificationCursorService } from './inbox/notification-cursor.service';
import { NotificationInboxService } from './inbox/notification-inbox.service';
import { NotificationController } from './inbox/notification.controller';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    JwtModule.register({}),
  ],
  controllers: [HealthController, NotificationController],
  providers: [
    PrismaService,
    JwtVerifierService,
    NotificationCursorService,
    NotificationInboxService,
    ApplicationEventProcessor,
    ApplicationEventConsumer,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: NoStoreInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
