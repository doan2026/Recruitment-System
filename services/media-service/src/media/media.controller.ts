import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExcludeController,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  CurrentInternalCaller,
  CurrentUser,
  InternalOnly,
  Roles,
} from '../common/auth/auth.decorators';
import {
  AuthUser,
  InternalCaller,
} from '../common/auth/auth-context';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiErrorResponseDto } from '../common/http/api-error-response.dto';
import {
  BindFileReferenceDto,
  ConfirmUploadDto,
  CreateUploadIntentDto,
  InternalCreateUploadIntentDto,
  InternalFileExpectationDto,
} from './dto/media-input.dto';
import {
  DownloadUrlDto,
  FileMetadataDto,
  FileReferenceDto,
  UploadCapabilityDto,
} from './dto/media-response.dto';
import { MediaService } from './media.service';

const FILE_ID_PIPE = new ParseUUIDPipe({ version: '4' });

@ApiTags('files')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@Roles(
  SystemRole.CANDIDATE,
  SystemRole.RECRUITER,
  SystemRole.ADMIN,
)
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('signature')
  @ApiOperation({ summary: 'Create a signed Cloudinary upload intent' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '8-128 safe characters',
  })
  @ApiCreatedResponse({ type: UploadCapabilityDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  createIntent(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateUploadIntentDto,
    @Headers('idempotency-key')
    idempotencyKey: string | string[] | undefined,
  ): Promise<UploadCapabilityDto> {
    return this.media.createPublicIntent(
      user,
      input,
      idempotencyKey,
    );
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm an upload using canonical provider metadata',
  })
  @ApiOkResponse({ type: FileMetadataDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  confirm(
    @CurrentUser() user: AuthUser,
    @Body() input: ConfirmUploadDto,
  ): Promise<FileMetadataDto> {
    return this.media.confirmPublic(user, input.fileId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get owner-scoped file metadata' })
  @ApiOkResponse({ type: FileMetadataDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', FILE_ID_PIPE) id: string,
  ): Promise<FileMetadataDto> {
    return this.media.getPublic(user, id);
  }

  @Post(':id/download-url')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create an owner-scoped private download URL',
  })
  @ApiOkResponse({ type: DownloadUrlDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  download(
    @CurrentUser() user: AuthUser,
    @Param('id', FILE_ID_PIPE) id: string,
  ): Promise<DownloadUrlDto> {
    return this.media.createPublicDownloadUrl(user, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an unreferenced owner-scoped file',
  })
  @ApiOkResponse({ type: FileMetadataDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  delete(
    @CurrentUser() user: AuthUser,
    @Param('id', FILE_ID_PIPE) id: string,
  ): Promise<FileMetadataDto> {
    return this.media.deletePublic(user, id);
  }
}

@ApiExcludeController()
@ApiTags('internal-files')
@ApiHeader({ name: 'X-Internal-Api-Key', required: true })
@ApiHeader({ name: 'X-Internal-Service', required: true })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@InternalOnly()
@Controller('internal')
export class InternalMediaController {
  constructor(private readonly media: MediaService) {}

  @Post('signature')
  @ApiCreatedResponse({ type: UploadCapabilityDto })
  createIntent(
    @CurrentInternalCaller() caller: InternalCaller,
    @Body() input: InternalCreateUploadIntentDto,
    @Headers('idempotency-key')
    idempotencyKey: string | string[] | undefined,
  ): Promise<UploadCapabilityDto> {
    return this.media.createInternalIntent(
      caller,
      input,
      idempotencyKey,
    );
  }

  @Post('confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: FileMetadataDto })
  confirm(
    @CurrentInternalCaller() caller: InternalCaller,
    @Body() input: ConfirmUploadDto,
  ): Promise<FileMetadataDto> {
    return this.media.confirmInternal(caller, input.fileId);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOkResponse({ type: FileMetadataDto })
  verify(
    @CurrentInternalCaller() caller: InternalCaller,
    @Body() input: InternalFileExpectationDto,
  ): Promise<FileMetadataDto> {
    return this.media.verifyInternal(caller, input);
  }

  @Post('download-url')
  @HttpCode(200)
  @ApiOkResponse({ type: DownloadUrlDto })
  download(
    @CurrentInternalCaller() caller: InternalCaller,
    @Body() input: InternalFileExpectationDto,
  ): Promise<DownloadUrlDto> {
    return this.media.createInternalDownloadUrl(caller, input);
  }

  @Post('references')
  @ApiCreatedResponse({ type: FileReferenceDto })
  bind(
    @CurrentInternalCaller() caller: InternalCaller,
    @Body() input: BindFileReferenceDto,
  ): Promise<FileReferenceDto> {
    return this.media.bindReference(caller, input);
  }

  @Delete('references/:id')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { released: { type: 'boolean' } },
    },
  })
  release(
    @CurrentInternalCaller() caller: InternalCaller,
    @Param('id', FILE_ID_PIPE) id: string,
  ): Promise<{ released: true }> {
    return this.media.releaseReference(caller, id);
  }

  @Delete('files/:id')
  @ApiOkResponse({ type: FileMetadataDto })
  delete(
    @CurrentInternalCaller() caller: InternalCaller,
    @Param('id', FILE_ID_PIPE) id: string,
  ): Promise<FileMetadataDto> {
    return this.media.deleteInternal(caller, id);
  }
}
