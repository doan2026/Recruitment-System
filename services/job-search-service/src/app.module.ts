import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import {
  ApiExceptionFilter,
  ApiResponseInterceptor,
  AuthGuard,
  RolesGuard,
} from './common';
import { CompanyClientService } from './company-client.service';
import { JobController } from './job.controller';
import { JobExpiryService } from './job-expiry.service';
import { JobSearchService } from './job-search.service';
import { JobService } from './job.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({}),
  ],
  controllers: [JobController],
  providers: [
    PrismaService,
    CompanyClientService,
    JobService,
    JobExpiryService,
    JobSearchService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
