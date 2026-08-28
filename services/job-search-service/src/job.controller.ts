import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import {
  ApiException,
  AuthUser,
  CurrentUser,
  Internal,
  Public,
  Roles,
  SystemRole,
} from './common';
import {
  CreateJobDto,
  JobDto,
  RejectJobDto,
  UpdateJobDto,
} from './job.dto';
import { ActiveJobStatsDto } from './job-stats.dto';
import { JobAvailabilityDto } from './job-availability.dto';
import {
  BulkJobDetailRequestDto,
  BulkJobDetailResultDto,
  JobDetailDto,
} from './job-detail.dto';
import {
  JobSearchItemDto,
  JobSearchQueryDto,
  JobSearchResultDto,
} from './job-search.dto';
import {
  JobRecommendationItemDto,
  JobRecommendationQueryDto,
  JobRecommendationResultDto,
} from './job-recommendation.dto';
import { JobRecommendationService } from './job-recommendation.service';
import { JobSearchService } from './job-search.service';
import { JobIndexFailure, JobIndexingService } from './job-indexing.service';
import { JobService } from './job.service';

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}
interface AuthorizationRequest {
  headers: { authorization: string };
}

const JOB_ID_PIPE = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new ApiException(
      'INVALID_JOB_ID',
      'job id must be a UUID v4',
      HttpStatus.BAD_REQUEST,
    ),
});
const COMPANY_ID_PIPE = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new ApiException(
      'INVALID_COMPANY_ID',
      'company_id must be a UUID v4',
      HttpStatus.BAD_REQUEST,
    ),
});
const envelope = (array = false) => ({
  type: 'object',
  properties: {
    data: array
      ? { type: 'array', items: { $ref: getSchemaPath(JobDto) } }
      : { $ref: getSchemaPath(JobDto) },
    meta: { type: 'object', nullable: true },
  },
});
const searchEnvelope = {
  type: 'object',
  properties: {
    data: { $ref: getSchemaPath(JobSearchResultDto) },
    meta: { type: 'object', nullable: true },
  },
};
const recommendationEnvelope = {
  type: 'object',
  properties: {
    data: { $ref: getSchemaPath(JobRecommendationResultDto) },
    meta: { type: 'object', nullable: true },
  },
};
const availabilityEnvelope = {
  type: 'object',
  properties: {
    data: { $ref: getSchemaPath(JobAvailabilityDto) },
    meta: { type: 'object', nullable: true },
  },
};
const activeJobStatsEnvelope = {
  type: 'object',
  properties: {
    data: { $ref: getSchemaPath(ActiveJobStatsDto) },
    meta: { type: 'object', nullable: true },
  },
};
const bulkJobDetailEnvelope = {
  type: 'object',
  properties: {
    data: { $ref: getSchemaPath(BulkJobDetailResultDto) },
    meta: { type: 'object', nullable: true },
  },
};

@ApiTags('jobs')
@ApiExtraModels(
  JobDto,
  JobAvailabilityDto,
  JobDetailDto,
  BulkJobDetailResultDto,
  ActiveJobStatsDto,
  JobSearchItemDto,
  JobSearchResultDto,
  JobRecommendationItemDto,
  JobRecommendationResultDto,
)
@Controller()
export class JobController {
  constructor(
    private readonly jobs: JobService,
    private readonly jobSearch: JobSearchService,
    private readonly recommendations: JobRecommendationService,
    private readonly indexing: JobIndexingService,
  ) {}
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Job Service health check' })
  health(): {
    service: string;
    status: string;
    searchIndexReady: boolean;
    recommendationConfigured: boolean;
  } {
    const searchIndexReady = this.indexing.isSearchReady();
    const recommendationConfigured = this.recommendations.isConfigured();
    return {
      service: 'job-search-service',
      status: searchIndexReady && recommendationConfigured
        ? 'UP'
        : 'DEGRADED',
      searchIndexReady,
      recommendationConfigured,
    };
  }
  @Post()
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()

  @ApiOperation({ summary: 'Create a DRAFT job for a VERIFIED company' })
  @ApiCreatedResponse({ schema: envelope() })
  create(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization: string,
    @Body() dto: CreateJobDto,
  ): Promise<JobDto> {
    return this.jobs.create(user.id, authorization, dto);
  }

  @Get('mine')
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List manageable jobs (OWNER: all company; MEMBER: own)',
  })
  @ApiOkResponse({ schema: envelope(true) })
  listMine(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization: string,
  ): Promise<JobDto[]> {
    return this.jobs.listManaged(user.id, authorization);
  }

  @Get('pending')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List up to 50 jobs awaiting Admin approval' })
  @ApiOkResponse({ schema: envelope(true) })
  listPending(): Promise<JobDto[]> {
    return this.jobs.listPending();
  }

  @Public()
  @Get('search')
  @ApiOperation({
    summary: 'Search published jobs with Elasticsearch and PostgreSQL fallback',
  })
  @ApiOkResponse({ schema: searchEnvelope })
  search(@Query() query: JobSearchQueryDto): Promise<JobSearchResultDto> {
    return this.jobSearch.search(query);
  }

  @Get('recommended')
  @Roles(SystemRole.CANDIDATE)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get AI-ranked jobs with explicit-preference/latest fallback',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
  })
  @ApiOkResponse({
    schema: recommendationEnvelope,
    headers: {
      'Cache-Control': {
        schema: { type: 'string', example: 'private, no-store' },
      },
      Vary: {
        schema: { type: 'string', example: 'Authorization' },
      },
    },
  })
  @ApiConflictResponse({
    description: 'The opaque recommendation cursor is stale',
    schema: {
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', example: 'RECOMMENDATION_CURSOR_STALE' },
        message: { type: 'string' },
        details: { type: 'object', nullable: true },
      },
      example: {
        code: 'RECOMMENDATION_CURSOR_STALE',
        message: 'Recommendation cursor is stale',
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'A continuation page cannot be resolved safely',
    schema: {
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', example: 'RECOMMENDATION_UNAVAILABLE' },
        message: { type: 'string' },
        details: { type: 'object', nullable: true },
      },
      example: {
        code: 'RECOMMENDATION_UNAVAILABLE',
        message: 'Recommendation service is temporarily unavailable',
      },
    },
  })
  recommended(
    @CurrentUser() user: AuthUser,
    @Req() request: AuthorizationRequest,
    @Query() query: JobRecommendationQueryDto,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<JobRecommendationResultDto> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Vary', 'Authorization');
    return this.recommendations.recommend(
      user.id,
      request.headers.authorization,
      query,
    );
  }

  @Post('reindex')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reconcile every job with Elasticsearch' })
  reindex(): Promise<{ queued: number }> {
    return this.indexing.reindexAll().then((queued) => ({ queued }));
  }

  @Get('reindex/failures')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List durable Elasticsearch indexing failures' })
  async indexFailures(): Promise<{ items: JobIndexFailure[] }> {
    return { items: await this.indexing.listFailures() };
  }

  @Post('reindex/failures/retry')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retry every failed Elasticsearch index sync' })
  async retryIndexFailures(): Promise<{ retried: number }> {
    return { retried: await this.indexing.retryFailures() };
  }

  @Internal()
  @Get('stats/active')
  @ApiHeader({
    name: 'X-Internal-Api-Key',
    required: true,
    description: 'Shared service-to-service secret',
  })
  @ApiOperation({ summary: 'Count active published jobs for a company' })
  @ApiQuery({
    name: 'company_id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ schema: activeJobStatsEnvelope })
  getActiveJobStats(
    @Query('company_id', COMPANY_ID_PIPE) companyId: string,
  ): Promise<ActiveJobStatsDto> {
    return this.jobs.getActiveJobStats(companyId);
  }

  @Internal()
  @Post('details/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'X-Internal-Api-Key',
    required: true,
    description: 'Shared service-to-service secret',
  })
  @ApiOperation({
    summary: 'Resolve public-safe job details for internal consumers',
  })
  @ApiOkResponse({ schema: bulkJobDetailEnvelope })
  getBulkDetails(
    @Body() dto: BulkJobDetailRequestDto,
  ): Promise<BulkJobDetailResultDto> {
    return this.jobs.getBulkDetails(dto.jobIds);
  }

  @Internal()
  @Get(':id/exists')
  @ApiHeader({
    name: 'X-Internal-Api-Key',
    required: true,
    description: 'Shared service-to-service secret',
  })
  @ApiOperation({
    summary: 'Check whether a job can accept a new application',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: availabilityEnvelope })
  getAvailability(
    @Param('id', JOB_ID_PIPE) jobId: string,
  ): Promise<JobAvailabilityDto> {
    return this.jobs.getAvailability(jobId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a PUBLISHED job publicly' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope() })
  getPublic(
    @Param('id', JOB_ID_PIPE) jobId: string,
  ): Promise<JobDto> {
    return this.jobs.getPublic(jobId);
  }

  @Put(':id')
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a manageable job' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope() })
  update(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization: string,
    @Param('id', JOB_ID_PIPE) jobId: string,
    @Body() dto: UpdateJobDto,
  ): Promise<JobDto> {
    return this.jobs.update(user.id, authorization, jobId, dto);
  }

  @Patch(':id/publish')
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a DRAFT job for Admin approval' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope() })
  publish(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization: string,
    @Param('id', JOB_ID_PIPE) jobId: string,
  ): Promise<JobDto> {
    return this.jobs.publish(user.id, authorization, jobId);
  }

  @Patch(':id/close')
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Close a PUBLISHED job' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope() })
  close(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization: string,
    @Param('id', JOB_ID_PIPE) jobId: string,
  ): Promise<JobDto> {
    return this.jobs.close(user.id, authorization, jobId);
  }

  @Patch(':id/approve')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a PENDING_APPROVAL job' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope() })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', JOB_ID_PIPE) jobId: string,
  ): Promise<JobDto> {
    return this.jobs.approve(user.id, jobId);
  }

  @Patch(':id/reject')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a PENDING_APPROVAL job to DRAFT' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope() })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', JOB_ID_PIPE) jobId: string,
    @Body() dto: RejectJobDto,
  ): Promise<JobDto> {
    return this.jobs.reject(user.id, jobId, dto.reason);
  }
}
