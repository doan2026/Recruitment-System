import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
import { CvBuilderService } from './cv-builder.service';
import {
  CreateOnlineCvDto,
  CreateOnlineCvRevisionDto,
} from './dto/profile-media-input.dto';
import { OnlineCvBuilderResponseDto } from './dto/profile-media-response.dto';

const UUID_PIPE = new ParseUUIDPipe({ version: '4' });
const ONLINE_CV_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(OnlineCvBuilderResponseDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

@ApiTags('candidate-cv-builder')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiNotFoundResponse({ type: ApiErrorResponseDto })
@ApiConflictResponse({ type: ApiErrorResponseDto })
@ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
@ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@ApiExtraModels(OnlineCvBuilderResponseDto, ApiErrorResponseDto)
@Roles(SystemRole.CANDIDATE)
@Controller()
export class CvBuilderController {
  constructor(private readonly builder: CvBuilderService) {}

  @Post(['cvs/online', 'cv/online'])
  @ApiOperation({
    summary: 'Publish a versioned Online CV snapshot',
    description:
      'Render the PDF client-side, confirm it with Media Service, then submit the resulting fileId with the versioned builder JSON.',
  })
  @ApiCreatedResponse({ schema: ONLINE_CV_ENVELOPE })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOnlineCvDto,
  ): Promise<OnlineCvBuilderResponseDto> {
    return this.builder.createOnlineCv(user.id, dto);
  }

  @Get(['cvs/:id/builder', 'cv/:id/builder'])
  @ApiOperation({ summary: 'Open my active Online CV builder snapshot' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: ONLINE_CV_ENVELOPE })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<OnlineCvBuilderResponseDto> {
    return this.builder.getOnlineCv(user.id, id);
  }

  @Post(['cvs/:id/revisions', 'cv/:id/revisions'])
  @ApiOperation({
    summary: 'Publish a replacement revision for my active Online CV',
    description:
      'Always creates a new cvId/fileId snapshot and soft-deletes the predecessor without releasing its historical Media reference.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ schema: ONLINE_CV_ENVELOPE })
  revise(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: CreateOnlineCvRevisionDto,
  ): Promise<OnlineCvBuilderResponseDto> {
    return this.builder.createRevision(user.id, id, dto);
  }
}
