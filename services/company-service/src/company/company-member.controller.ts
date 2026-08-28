import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth-user.interface';
import {
  CurrentAccessToken,
  CurrentUser,
} from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiException } from '../common/errors/api-exception';
import { CompanyMemberService } from './company-member.service';
import { AcceptCompanyInvitationDto } from './dto/accept-company-invitation.dto';
import {
  CompanyMemberDto,
  CreatedCompanyInvitationDto,
  RecruiterCompanyDto,
  RemovedCompanyMemberDto,
} from './dto/company-member.dto';
import { InviteCompanyMemberDto } from './dto/invite-company-member.dto';

const uuidPipe = (subject: 'company' | 'user') =>
  new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () =>
      new ApiException(
        'INVALID_' + subject.toUpperCase() + '_ID',
        subject + ' id must be a UUID v4',
        HttpStatus.BAD_REQUEST,
      ),
  });

const COMPANY_ID_PIPE = uuidPipe('company');
const USER_ID_PIPE = uuidPipe('user');

const envelope = (data: Record<string, unknown>) => ({
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data,
    meta: { type: 'object', nullable: true, example: null },
  },
});

const MEMBER_LIST_ENVELOPE = envelope({
  type: 'array',
  items: { $ref: getSchemaPath(CompanyMemberDto) },
});
const INVITATION_ENVELOPE = envelope({
  $ref: getSchemaPath(CreatedCompanyInvitationDto),
});
const RECRUITER_COMPANY_ENVELOPE = envelope({
  $ref: getSchemaPath(RecruiterCompanyDto),
});
const REMOVED_MEMBER_ENVELOPE = envelope({
  $ref: getSchemaPath(RemovedCompanyMemberDto),
});

@ApiTags('company members')
@ApiBearerAuth()
@ApiExtraModels(
  CompanyMemberDto,
  CreatedCompanyInvitationDto,
  RecruiterCompanyDto,
  RemovedCompanyMemberDto,
)
@Controller()
export class CompanyMemberController {
  constructor(
    private readonly companyMemberService: CompanyMemberService,
  ) {}

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.RECRUITER)
  @ApiOperation({ summary: 'Accept a company invitation as a recruiter' })
  @ApiOkResponse({ schema: RECRUITER_COMPANY_ENVELOPE })
  @ApiNotFoundResponse({ description: 'Invitation token was not found' })
  @ApiUnauthorizedResponse({
    description: 'The durable Auth account no longer exists',
  })
  @ApiForbiddenResponse({
    description:
      'The durable account is inactive or its email does not match the invitation',
  })
  @ApiConflictResponse({
    description:
      'Invitation is inactive, requires reissue, or recruiter already has a company',
  })
  acceptInvitation(
    @CurrentUser() user: AuthUser,
    @CurrentAccessToken() accessToken: string,
    @Body() dto: AcceptCompanyInvitationDto,
  ): Promise<RecruiterCompanyDto> {
    return this.companyMemberService.accept(user.id, accessToken, dto);
  }

  @Get('by-user/:userId')
  @Roles(SystemRole.RECRUITER, SystemRole.ADMIN)
  @ApiOperation({
    summary: 'Resolve recruiter company for internal authorization checks',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ schema: RECRUITER_COMPANY_ENVELOPE })
  @ApiForbiddenResponse({
    description: 'A recruiter attempted to query another recruiter',
  })
  getByUser(
    @CurrentUser() user: AuthUser,
    @Param('userId', USER_ID_PIPE) targetUserId: string,
  ): Promise<RecruiterCompanyDto> {
    return this.companyMemberService.getByUser(
      user.id,
      user.systemRole,
      targetUserId,
    );
  }

  @Post(':id/members')
  @Roles(SystemRole.RECRUITER)
  @ApiOperation({ summary: 'Create or refresh a member invitation as OWNER' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ schema: INVITATION_ENVELOPE })
  @ApiForbiddenResponse({ description: 'Company OWNER role is required' })
  invite(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
    @Body() dto: InviteCompanyMemberDto,
  ): Promise<CreatedCompanyInvitationDto> {
    return this.companyMemberService.invite(user.id, companyId, dto);
  }

  @Get(':id/members')
  @Roles(SystemRole.RECRUITER)
  @ApiOperation({ summary: 'List company members as OWNER' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: MEMBER_LIST_ENVELOPE })
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
  ): Promise<CompanyMemberDto[]> {
    return this.companyMemberService.listMembers(user.id, companyId);
  }

  @Delete(':id/members/:userId')
  @Roles(SystemRole.RECRUITER)
  @ApiOperation({ summary: 'Remove a MEMBER as company OWNER' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ schema: REMOVED_MEMBER_ENVELOPE })
  @ApiConflictResponse({
    description: 'The current OWNER cannot be removed',
  })
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
    @Param('userId', USER_ID_PIPE) targetUserId: string,
  ): Promise<RemovedCompanyMemberDto> {
    return this.companyMemberService.removeMember(
      user.id,
      companyId,
      targetUserId,
    );
  }

  @Patch(':id/members/:userId/transfer-ownership')
  @Roles(SystemRole.RECRUITER)
  @ApiOperation({ summary: 'Transfer OWNER role to an existing MEMBER' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ schema: MEMBER_LIST_ENVELOPE })
  @ApiConflictResponse({
    description: 'The target recruiter is not a MEMBER of this company',
  })
  transferOwnership(
    @CurrentUser() user: AuthUser,
    @Param('id', COMPANY_ID_PIPE) companyId: string,
    @Param('userId', USER_ID_PIPE) targetUserId: string,
  ): Promise<CompanyMemberDto[]> {
    return this.companyMemberService.transferOwnership(
      user.id,
      companyId,
      targetUserId,
    );
  }
}
