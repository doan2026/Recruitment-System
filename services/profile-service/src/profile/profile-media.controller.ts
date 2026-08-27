import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import {
  AttachAvatarDto,
  CreateUploadedCvDto,
  CvVersionPreconditionDto,
  RenameUploadedCvDto,
} from './dto/profile-media-input.dto';
import {
  CvDownloadResponseDto,
  DeletedCvResponseDto,
  UploadedCvResponseDto,
} from './dto/profile-media-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { ProfileMediaService } from './profile-media.service';

const UUID_PIPE = new ParseUUIDPipe({ version: '4' });
const envelope = (model: new () => object) => ({
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(model) },
    meta: { type: 'object', nullable: true, example: null },
  },
});
const CV_LIST_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'array',
      items: { $ref: getSchemaPath(UploadedCvResponseDto) },
    },
    meta: { type: 'object', nullable: true, example: null },
  },
};

@ApiTags('candidate-profile-media')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiNotFoundResponse({ type: ApiErrorResponseDto })
@ApiConflictResponse({ type: ApiErrorResponseDto })
@ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
@ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@ApiExtraModels(
  ProfileResponseDto,
  UploadedCvResponseDto,
  CvDownloadResponseDto,
  DeletedCvResponseDto,
  ApiErrorResponseDto,
)
@Roles(SystemRole.CANDIDATE)
@Controller()
export class ProfileMediaController {
  constructor(private readonly media: ProfileMediaService) {}

  @Put(':userId/avatar')
  @ApiOperation({ summary: 'Attach a verified avatar to my profile' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ schema: envelope(ProfileResponseDto) })
  attachAvatar(
    @CurrentUser() user: AuthUser,
    @Param('userId', UUID_PIPE) userId: string,
    @Body() dto: AttachAvatarDto,
  ): Promise<ProfileResponseDto> {
    return this.media.attachAvatar(user.id, userId, dto.fileId);
  }

  @Delete(':userId/avatar')
  @ApiOperation({ summary: 'Remove the avatar from my profile' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ schema: envelope(ProfileResponseDto) })
  removeAvatar(
    @CurrentUser() user: AuthUser,
    @Param('userId', UUID_PIPE) userId: string,
  ): Promise<ProfileResponseDto> {
    return this.media.removeAvatar(user.id, userId);
  }

  @Post(['cvs', 'cv'])
  @ApiOperation({ summary: 'Register one of my verified uploaded CVs' })
  @ApiCreatedResponse({ schema: envelope(UploadedCvResponseDto) })
  createCv(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadedCvDto,
  ): Promise<UploadedCvResponseDto> {
    return this.media.createUploadedCv(user.id, dto);
  }

  @Get(['cvs', 'cv'])
  @ApiOperation({ summary: 'List my active uploaded CVs' })
  @ApiOkResponse({ schema: CV_LIST_ENVELOPE })
  listCvs(
    @CurrentUser() user: AuthUser,
  ): Promise<UploadedCvResponseDto[]> {
    return this.media.listUploadedCvs(user.id);
  }

  @Patch(['cvs/:id', 'cv/:id'])
  @ApiOperation({ summary: 'Rename one of my active uploaded CVs' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope(UploadedCvResponseDto) })
  renameCv(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: RenameUploadedCvDto,
  ): Promise<UploadedCvResponseDto> {
    return this.media.renameUploadedCv(user.id, id, dto);
  }

  @Patch(['cvs/:id/default', 'cv/:id/default'])
  @ApiOperation({ summary: 'Make one of my active uploaded CVs the default' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope(UploadedCvResponseDto) })
  setDefaultCv(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: CvVersionPreconditionDto,
  ): Promise<UploadedCvResponseDto> {
    return this.media.setDefaultUploadedCv(
      user.id,
      id,
      dto.expectedAggregateVersion,
    );
  }

  @Delete(['cvs/:id', 'cv/:id'])
  @ApiOperation({
    summary: 'Soft-delete one of my uploaded CVs',
    description:
      'The CV record and its private Media reference are retained so historical applications remain resolvable.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope(DeletedCvResponseDto) })
  deleteCv(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: CvVersionPreconditionDto,
  ): Promise<DeletedCvResponseDto> {
    return this.media.softDeleteUploadedCv(
      user.id,
      id,
      dto.expectedAggregateVersion,
    );
  }

  @Post(['cvs/:id/download-url', 'cv/:id/download-url'])
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a short-lived download URL for my CV' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope(CvDownloadResponseDto) })
  downloadCv(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<CvDownloadResponseDto> {
    return this.media.createCvDownloadUrl(user.id, id);
  }

  @Get(['cvs/:id', 'cv/:id'])
  @ApiOperation({ summary: 'Get one of my active CVs' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: envelope(UploadedCvResponseDto) })
  getCv(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<UploadedCvResponseDto> {
    return this.media.getUploadedCv(user.id, id);
  }
}
