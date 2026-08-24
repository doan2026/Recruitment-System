import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiException,
  AuthUser,
  CurrentUser,
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
import {
  JobSearchItemDto,
  JobSearchQueryDto,
  JobSearchResultDto,
} from './job-search.dto';
import { JobSearchService } from './job-search.service';
import { JobIndexingService } from './job-indexing.service';
import { JobService } from './job.service';

const JOB_ID_PIPE = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new ApiException(
      'INVALID_JOB_ID',
      'job id must be a UUID v4',
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

@ApiTags('jobs')
@ApiExtraModels(JobDto, JobSearchItemDto, JobSearchResultDto)
@Controller()
export class JobController {
  constructor(
    private readonly jobs: JobService,
    private readonly jobSearch: JobSearchService,
    private readonly indexing: JobIndexingService,
  ) {}
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Job Service health check' })
  health(): { service: string; status: string } {
    return { service: 'job-search-service', status: 'UP' };
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

  @Post('reindex')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Queue every PUBLISHED job for reindexing' })
  reindex(): Promise<{ queued: number }> {
    return this.indexing.reindexAll().then((queued) => ({ queued }));
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
