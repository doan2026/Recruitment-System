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
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth-user.interface';
import { CurrentUser, Roles } from '../common/auth/auth.decorators';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiErrorResponseDto } from '../common/http/api-error-response.dto';
import {
  PutRecruiterDiscoveryDto,
  RecruiterDiscoveryResponseDto,
} from './dto/recruiter-discovery.dto';
import { RecruiterDiscoveryService } from './recruiter-discovery.service';

const RECRUITER_DISCOVERY_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(RecruiterDiscoveryResponseDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

@ApiTags('candidate-recruiter-discovery')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiConflictResponse({ type: ApiErrorResponseDto })
@ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
@ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@ApiExtraModels(
  RecruiterDiscoveryResponseDto,
  PutRecruiterDiscoveryDto,
  ApiErrorResponseDto,
)
@Roles(SystemRole.CANDIDATE)
@Controller('recruiter-discovery')
export class RecruiterDiscoveryController {
  constructor(private readonly discovery: RecruiterDiscoveryService) {}

  @Get()
  @Header('Pragma', 'no-cache')
  @Header('Vary', 'Authorization')
  @ApiOperation({
    summary: 'Get my explicit recruiter discovery consent',
    description:
      'Returns UNSET at version 0 until the Candidate explicitly decides. ' +
      'Only the fixed FULL_NAME, HEADLINE and SKILLS projection may be shared.',
  })
  @ApiOkResponse({ schema: RECRUITER_DISCOVERY_ENVELOPE })
  get(
    @CurrentUser() candidate: AuthUser,
  ): Promise<RecruiterDiscoveryResponseDto> {
    return this.discovery.get(candidate.id);
  }

  @Put()
  @Header('Pragma', 'no-cache')
  @Header('Vary', 'Authorization')
  @ApiOperation({
    summary: 'Replace my explicit recruiter discovery consent',
    description:
      'Uses expectedVersion compare-and-set. ENABLED binds one explicit ' +
      'active owned private CV; DISABLED withdraws consent and clears it.',
  })
  @ApiOkResponse({ schema: RECRUITER_DISCOVERY_ENVELOPE })
  replace(
    @CurrentUser() candidate: AuthUser,
    @Body() dto: PutRecruiterDiscoveryDto,
  ): Promise<RecruiterDiscoveryResponseDto> {
    return this.discovery.replace(candidate.id, dto);
  }
}
