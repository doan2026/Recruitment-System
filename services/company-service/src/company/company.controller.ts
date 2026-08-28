import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  ParseUUIDPipe,
  Query,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../common/auth/auth-user.interface';
import { Public } from '../common/auth/public.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiException } from '../common/errors/api-exception';
import { ApiSuccessResponse } from '../common/http/api-response.interceptor';
import { CompanyService } from './company.service';
import {
  CompanyMediaResponseDto,
  CompanyProfileDto,
  LogoReferenceResponseDto,
} from './dto/company-profile.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CompanyMediaUploadCapabilityDto,
  CompanyMediaUploadResultDto,
  ConfirmCompanyMediaUploadDto,
  CreateCompanyMediaUploadDto,
} from './dto/company-media-upload.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import {
  PublicCompanySearchQueryDto,
  PublicCompanySearchSummaryDto,
} from './dto/public-company-search.dto';
import {
  PublicCompanyMediaDto,
  PublicCompanyProfileDto,
} from './dto/public-company-profile.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { VerifyCompanyDto } from './dto/verify-company.dto';

const COMPANY_ID_PIPE = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new ApiException(
      'INVALID_COMPANY_ID',
      'company id must be a UUID v4',
      HttpStatus.BAD_REQUEST,
    ),
});

const COMPANY_PROFILE_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(CompanyProfileDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

const COMPANY_LIST_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'array',
      items: { $ref: getSchemaPath(CompanyProfileDto) },
    },
    meta: {
      type: 'object',
      required: ['page', 'limit', 'total', 'totalPages'],
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0 },
        totalPages: { type: 'integer', minimum: 0 },
      },
    },
  },
};

const PUBLIC_COMPANY_PROFILE_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(PublicCompanyProfileDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

const PUBLIC_COMPANY_SEARCH_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'array',
      items: { $ref: getSchemaPath(PublicCompanySearchSummaryDto) },
    },
    meta: {
      type: 'object',
      required: ['limit', 'hasMore', 'nextCursor'],
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        hasMore: { type: 'boolean' },
        nextCursor: {
          type: 'string',
          nullable: true,
          minLength: 1,
          maxLength: 1024,
          pattern: '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}$',
        },
      },
    },
  },
};

const COMPANY_MEDIA_UPLOAD_CAPABILITY_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(CompanyMediaUploadCapabilityDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

const COMPANY_MEDIA_UPLOAD_RESULT_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(CompanyMediaUploadResultDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

@ApiTags('companies')
@ApiExtraModels(
  CompanyProfileDto,
  PublicCompanySearchSummaryDto,
  PublicCompanyProfileDto,
  PublicCompanyMediaDto,
  LogoReferenceResponseDto,
  CompanyMediaResponseDto,
  CompanyMediaUploadCapabilityDto,
  CompanyMediaUploadResultDto,
)
@Controller()
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a company and its OWNER membership atomically',
  })
  @ApiCreatedResponse({ schema: COMPANY_PROFILE_ENVELOPE })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCompanyDto,
  ): Promise<CompanyProfileDto> {
    return this.companyService.create(user.id, dto);
  }

  @Get()
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List companies for the admin review queue' })
  @ApiOkResponse({ schema: COMPANY_LIST_ENVELOPE })
  listForReview(
    @Query() query: ListCompaniesQueryDto,
  ): Promise<ApiSuccessResponse<CompanyProfileDto[]>> {
    return this.companyService.listForReview(query);
  }

  @Post('me/submit-verification')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resubmit the authenticated OWNER company after rejection',
  })
  @ApiOkResponse({ schema: COMPANY_PROFILE_ENVELOPE })
  @ApiConflictResponse({
    description: 'The company is VERIFIED and cannot be resubmitted',
  })
  resubmit(
    @CurrentUser() user: AuthUser,
  ): Promise<CompanyProfileDto> {
    return this.companyService.resubmit(user.id);
  }

  @Patch(':id/verify')
  @Roles(SystemRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject a PENDING company' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: COMPANY_PROFILE_ENVELOPE })
  @ApiBadRequestResponse({
    description: 'REJECT requires a reason; APPROVE must omit it',
  })
  @ApiNotFoundResponse({ description: 'The company does not exist' })
  @ApiConflictResponse({
    description: 'The company is not PENDING and the decision is not a retry',
  })
  verify(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
    @Body() dto: VerifyCompanyDto,
  ): Promise<CompanyProfileDto> {
    return this.companyService.verify(user.id, companyId, dto);
  }

  @Get('me')
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the authenticated recruiter company, including review status',
  })
  @ApiOkResponse({ schema: COMPANY_PROFILE_ENVELOPE })
  getMine(@CurrentUser() user: AuthUser): Promise<CompanyProfileDto> {
    return this.companyService.getMine(user.id);
  }

  @Public()
  @Get('search')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Search verified companies with signed keyset pagination',
  })
  @ApiOkResponse({
    schema: PUBLIC_COMPANY_SEARCH_ENVELOPE,
    headers: {
      'Cache-Control': {
        schema: { type: 'string', example: 'no-store' },
      },
      Pragma: {
        schema: { type: 'string', example: 'no-cache' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'The search query or cursor is invalid',
  })
  searchPublic(
    @Query() query: PublicCompanySearchQueryDto,
  ): Promise<ApiSuccessResponse<PublicCompanySearchSummaryDto[]>> {
    return this.companyService.searchPublic(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a verified public company profile' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PUBLIC_COMPANY_PROFILE_ENVELOPE })
  @ApiNotFoundResponse({
    description: 'The company does not exist or is not verified',
  })
  getPublic(
    @Param('id', COMPANY_ID_PIPE) companyId: string,
  ): Promise<PublicCompanyProfileDto> {
    return this.companyService.getPublicById(companyId);
  }

  @Post(':id/media/signature')
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Create a signed Company-owned upload intent as its OWNER',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Stable 8-128 character key for retrying this upload intent',
  })
  @ApiCreatedResponse({ schema: COMPANY_MEDIA_UPLOAD_CAPABILITY_ENVELOPE })
  @ApiConflictResponse({ description: 'Idempotency key or upload intent conflict' })
  @ApiResponse({ status: 422, description: 'Media policy or ownership rejected' })
  @ApiResponse({ status: 429, description: 'Media upload rate limit reached' })
  @ApiResponse({ status: 503, description: 'Media Service unavailable or invalid response' })
  createMediaUploadIntent(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCompanyMediaUploadDto,
  ): Promise<CompanyMediaUploadCapabilityDto> {
    return this.companyService.createMediaUploadIntent(
      user.id,
      companyId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':id/media/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Confirm and verify a Company-owned upload as its OWNER',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: COMPANY_MEDIA_UPLOAD_RESULT_ENVELOPE })
  @ApiConflictResponse({ description: 'Confirmation state changed concurrently' })
  @ApiResponse({ status: 422, description: 'Upload intent, ownership or type mismatch' })
  @ApiResponse({ status: 429, description: 'Media confirmation retry limit reached' })
  @ApiResponse({ status: 503, description: 'Media Service unavailable or invalid response' })
  confirmMediaUpload(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
    @Body() dto: ConfirmCompanyMediaUploadDto,
  ): Promise<CompanyMediaUploadResultDto> {
    return this.companyService.confirmMediaUpload(
      user.id,
      companyId,
      dto,
    );
  }

  @Put(':id')
  @Roles(SystemRole.RECRUITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a company profile as its OWNER' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: COMPANY_PROFILE_ENVELOPE })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<CompanyProfileDto> {
    return this.companyService.update(user.id, companyId, dto);
  }
}
