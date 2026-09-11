import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import {
  ApiExceptionFilter,
  ApiResponseInterceptor,
  AuthGuard,
  RolesGuard,
} from './common';
import { JobEventPublisherService } from './job-event-publisher.service';
import { CompanyClientService } from './company-client.service';
import { JobController } from './job.controller';
import {
  MetricsController,
  MetricsMiddleware,
  MetricsRegistry,
} from './metrics';
import { JobExpiryService } from './job-expiry.service';
import { JobIndexingService } from './job-indexing.service';
import { AiRecommendationClientService } from './ai-recommendation-client.service';
import { JobRecommendationService } from './job-recommendation.service';
import { ProfileRecommendationClientService } from './profile-recommendation-client.service';
import { AiCandidateRecommendationClientService } from './ai-candidate-recommendation-client.service';
import { ProfileCandidateDiscoveryClientService } from './profile-candidate-discovery-client.service';
import { RecruiterCandidateRecommendationService } from './recruiter-candidate-recommendation.service';
import { JobSearchCursorService } from './job-search-cursor.service';
import { JobSearchService } from './job-search.service';
import { JobService } from './job.service';
import { JwtVerifierService } from './jwt-verifier.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.NODE_ENV === 'test' }),
    JwtModule.register({}),
  ],
  // MetricsController first: JobController declares @Get(':id') at the root
  // path, which would otherwise match /metrics and reject it as a bad UUID.
  controllers: [MetricsController, JobController],
  providers: [
    MetricsRegistry,
    MetricsMiddleware,
    PrismaService,
    CompanyClientService,
    JobService,
    JobExpiryService,
    JobIndexingService,
    JobEventPublisherService,
    JobSearchCursorService,
    JobSearchService,
    JwtVerifierService,
    JobRecommendationService,
    AiRecommendationClientService,
    ProfileRecommendationClientService,
    AiCandidateRecommendationClientService,
    ProfileCandidateDiscoveryClientService,
    RecruiterCandidateRecommendationService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Recorded for every path, so a 404 flood and a crash are both visible as
    // availability events rather than disappearing before any handler runs.
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}
