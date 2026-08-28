import { Module, ValidationPipe } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JobIndexingService } from './job-indexing.service';
import {
  JOB_RECOMMENDATION_MAX_SALARY,
  canonicalizeRecommendationLocation,
  JobRecommendationFallbackReason,
  JobRecommendationQueryDto,
  JobRecommendationSource,
} from './job-recommendation.dto';
import { JobRecommendationService } from './job-recommendation.service';
import { JobSearchService } from './job-search.service';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { SystemRole } from './common';
import { RecruiterCandidateRecommendationService } from './recruiter-candidate-recommendation.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('Job recommendation HTTP contract', () => {
  it('validates bounded filters and applies safe defaults', async () => {
    const defaults = plainToInstance(JobRecommendationQueryDto, {});
    expect(await validate(defaults)).toHaveLength(0);
    expect(defaults.limit).toBe(10);

    const boundary = plainToInstance(JobRecommendationQueryDto, {
      limit: '50',
      cursor: 'opaque',
      location: '  Ha\u3000Noi  ',
      salaryMin: String(JOB_RECOMMENDATION_MAX_SALARY),
      jobType: 'FULL_TIME',
    });
    expect(await validate(boundary)).toHaveLength(0);
    expect(boundary).toMatchObject({
      limit: 50,
      cursor: 'opaque',
      location: 'Ha Noi',
      salaryMin: JOB_RECOMMENDATION_MAX_SALARY,
      jobType: 'FULL_TIME',
    });
    expect(canonicalizeRecommendationLocation('  Ha\u3000  Noi  '))
      .toBe('Ha Noi');
  });

  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { cursor: '🙂'.repeat(300) },
    { location: 'Ha\nNoi' },
    { location: `Ha Noi${String.fromCharCode(0x85)}` },
    { location: 'Ha%Noi' },
    { location: 'Ha_Noi' },
    { location: 'Ha\\Noi' },
    { location: 'Ha\uff05Noi' },
    { location: 'Ha\uff3cNoi' },
    { location: '   ' },
    { location: `  ${'a'.repeat(256)}  ` },
    { salaryMin: -1 },
    { salaryMin: 10_000_000_000_000 },
    { salaryMin: 1.111 },
    { jobType: 'CONTRACT' },
  ])('rejects an unsafe query: %j', async (value) => {
    const dto = plainToInstance(JobRecommendationQueryDto, value);
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('forbids userId and cvId query injection through the global policy',
  async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(pipe.transform(
      { userId: CANDIDATE_ID, cvId: CV_ID },
      {
        type: 'query',
        metatype: JobRecommendationQueryDto,
        data: undefined,
      },
    )).rejects.toBeDefined();
  });

  it('sets private response headers and forwards only JWT-derived identity',
  async () => {
    const recommend = jest.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      source: JobRecommendationSource.LATEST,
      fallbackReason: JobRecommendationFallbackReason.NO_ACTIVE_CV,
    });
    const controller = new JobController(
      {} as JobService,
      {} as JobSearchService,
      { recommend } as unknown as JobRecommendationService,
      {} as JobIndexingService,
      {} as RecruiterCandidateRecommendationService,
    );
    const setHeader = jest.fn();
    const query = { limit: 10 } as JobRecommendationQueryDto;

    await controller.recommended(
      { id: CANDIDATE_ID, systemRole: SystemRole.CANDIDATE },
      { headers: { authorization: AUTHORIZATION } },
      query,
      { setHeader },
    );

    expect(recommend).toHaveBeenCalledWith(
      CANDIDATE_ID,
      AUTHORIZATION,
      query,
    );
    expect(setHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store'],
      ['Pragma', 'no-cache'],
      ['Vary', 'Authorization'],
    ]);
  });

  it('declares the static Candidate route before the dynamic UUID route', () => {
    const prototype = JobController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, prototype.recommended))
      .toBe('recommended');
    expect(Reflect.getMetadata('roles', prototype.recommended))
      .toEqual([SystemRole.CANDIDATE]);

    const methods = Object.getOwnPropertyNames(prototype);
    expect(methods.indexOf('recommended')).toBeLessThan(
      methods.indexOf('getPublic'),
    );
  });

  it('degrades health without exposing an unsafe AI-key value', () => {
    const controller = new JobController(
      {} as JobService,
      {} as JobSearchService,
      { isConfigured: () => false } as unknown as JobRecommendationService,
      { isSearchReady: () => true } as unknown as JobIndexingService,
      {
        isConfigured: () => true,
      } as unknown as RecruiterCandidateRecommendationService,
    );

    expect(controller.health()).toEqual({
      service: 'job-search-service',
      status: 'DEGRADED',
      searchIndexReady: true,
      recommendationConfigured: false,
      candidateRecommendationConfigured: true,
    });
  });

  it('degrades health when recruiter Candidate recommendation is unconfigured',
  () => {
    const controller = new JobController(
      {} as JobService,
      {} as JobSearchService,
      { isConfigured: () => true } as unknown as JobRecommendationService,
      { isSearchReady: () => true } as unknown as JobIndexingService,
      {
        isConfigured: () => false,
      } as unknown as RecruiterCandidateRecommendationService,
    );

    expect(controller.health()).toEqual({
      service: 'job-search-service',
      status: 'DEGRADED',
      searchIndexReady: true,
      recommendationConfigured: true,
      candidateRecommendationConfigured: false,
    });
  });

  it('publishes Swagger bearer/query/response-header contracts', async () => {
    const app = await NestFactory.create(RecommendationContractModule, {
      logger: false,
    });
    try {
      await app.init();
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth().build(),
      );
      const operation = document.paths['/recommended']?.get;
      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);

      const parameters = (operation?.parameters ?? []).flatMap((parameter) =>
        'name' in parameter ? [parameter.name] : []
      );
      expect(parameters.sort()).toEqual([
        'cursor',
        'jobType',
        'limit',
        'location',
        'salaryMin',
      ]);
      expect(parameters).not.toContain('userId');
      expect(parameters).not.toContain('cvId');

      const success = operation?.responses['200'];
      expect(success).toBeDefined();
      expect(
        success && 'headers' in success
          ? Object.keys(success.headers ?? {}).sort()
          : [],
      ).toEqual(['Cache-Control', 'Vary']);
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
        '200',
        '409',
        '503',
      ]);
      expect(
        document.components?.schemas?.JobRecommendationResultDto,
      ).toMatchObject({
        properties: {
          source: {
            enum: ['AI', 'PREFERENCES', 'LATEST'],
          },
        },
      });
    } finally {
      await app.close();
    }
  });
});

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const CV_ID = '22222222-2222-4222-8222-222222222222';
const AUTHORIZATION = 'Bearer candidate.jwt.token';

@Module({
  controllers: [JobController],
  providers: [
    { provide: JobService, useValue: {} },
    { provide: JobSearchService, useValue: {} },
    { provide: JobRecommendationService, useValue: {} },
    { provide: JobIndexingService, useValue: {} },
    { provide: RecruiterCandidateRecommendationService, useValue: {} },
  ],
})
class RecommendationContractModule {}
