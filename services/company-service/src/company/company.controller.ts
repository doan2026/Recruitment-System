import {
  Body,
  Controller,
  Get,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../common/auth/auth-user.interface';
import { Public } from '../common/auth/public.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiException } from '../common/errors/api-exception';
import { CompanyService } from './company.service';
import {
  CompanyMediaResponseDto,
  CompanyProfileDto,
  LogoReferenceResponseDto,
} from './dto/company-profile.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  PublicCompanyMediaDto,
  PublicCompanyProfileDto,
} from './dto/public-company-profile.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

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

const PUBLIC_COMPANY_PROFILE_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(PublicCompanyProfileDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

@ApiTags('companies')
@ApiExtraModels(
  CompanyProfileDto,
  PublicCompanyProfileDto,
  PublicCompanyMediaDto,
  LogoReferenceResponseDto,
  CompanyMediaResponseDto,
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
