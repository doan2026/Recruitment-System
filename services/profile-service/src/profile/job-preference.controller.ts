import {
  Body,
  Controller,
  Get,
  Header,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth-user.interface';
import { CurrentUser, Roles } from '../common/auth/auth.decorators';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiErrorResponseDto } from '../common/http/api-error-response.dto';
import {
  JobPreferenceResponseDto,
  PutJobPreferenceDto,
} from './dto/job-preference.dto';
import { JobPreferenceService } from './job-preference.service';

const JOB_PREFERENCE_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(JobPreferenceResponseDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

@ApiTags('candidate-job-preferences')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiConflictResponse({ type: ApiErrorResponseDto })
@ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@ApiExtraModels(
  JobPreferenceResponseDto,
  PutJobPreferenceDto,
  ApiErrorResponseDto,
)
@Roles(SystemRole.CANDIDATE)
@Controller('job-preferences')
export class JobPreferenceController {
  constructor(private readonly preferences: JobPreferenceService) {}

  @Get()
  @Header('Pragma', 'no-cache')
  @Header('Vary', 'Authorization')
  @ApiOperation({
    summary: 'Get my explicit job recommendation preferences',
    description:
      'Returns an UNSET version-0 projection when the Candidate has never configured preferences.',
  })
  @ApiOkResponse({ schema: JOB_PREFERENCE_ENVELOPE })
  get(
    @CurrentUser() candidate: AuthUser,
  ): Promise<JobPreferenceResponseDto> {
    return this.preferences.get(candidate.id);
  }

  @Put()
  @Header('Pragma', 'no-cache')
  @Header('Vary', 'Authorization')
  @ApiOperation({
    summary: 'Replace my explicit job recommendation preferences',
    description:
      'Uses expectedVersion compare-and-set. DISABLED clears every criterion atomically.',
  })
  @ApiOkResponse({ schema: JOB_PREFERENCE_ENVELOPE })
  replace(
    @CurrentUser() candidate: AuthUser,
    @Body() dto: PutJobPreferenceDto,
  ): Promise<JobPreferenceResponseDto> {
    return this.preferences.replace(candidate.id, dto);
  }
}
