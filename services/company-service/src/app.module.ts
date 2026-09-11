import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './common/auth/auth.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { ApiResponseInterceptor } from './common/http/api-response.interceptor';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { CompanyModule } from './company/company.module';
import { HealthController } from './health/health.controller';
import {
  MetricsController,
  MetricsMiddleware,
  MetricsRegistry,
} from './metrics';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.NODE_ENV === 'test' }),
    PrismaModule,
    AuthModule,
    CompanyModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    MetricsRegistry,
    MetricsMiddleware,
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
