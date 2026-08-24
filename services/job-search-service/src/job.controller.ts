import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { CreateJobDto, JobDto, UpdateJobDto } from './job.dto';
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

@ApiTags('jobs')
@ApiExtraModels(JobDto)
@Controller()
export class JobController {
  constructor(private readonly jobs: JobService) {}
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
}
