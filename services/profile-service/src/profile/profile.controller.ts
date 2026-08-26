import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error-response.dto';
import { AuthUser } from '../common/auth/auth-user.interface';
import {
  CurrentUser,
  Roles,
} from '../common/auth/auth.decorators';
import { SystemRole } from '../common/auth/system-role.enum';
import {
  CreateCertificateDto,
  CreateEducationDto,
  CreateExperienceDto,
  CreateProjectDto,
  CreateSkillDto,
  UpdateCertificateDto,
  UpdateEducationDto,
  UpdateExperienceDto,
  UpdateProfileDto,
  UpdateProjectDto,
  UpdateSkillDto,
} from './dto/profile-input.dto';
import {
  CertificateResponseDto,
  EducationResponseDto,
  ExperienceResponseDto,
  ProfileResponseDto,
  ProjectResponseDto,
  SkillResponseDto,
} from './dto/profile-response.dto';
import { ProfileService } from './profile.service';

const UUID_PIPE = new ParseUUIDPipe({ version: '4' });
const PROFILE_ENVELOPE = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { $ref: getSchemaPath(ProfileResponseDto) },
    meta: { type: 'object', nullable: true, example: null },
  },
};

@ApiTags('candidate-profile')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiNotFoundResponse({ type: ApiErrorResponseDto })
@ApiConflictResponse({ type: ApiErrorResponseDto })
@ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@ApiExtraModels(
  ProfileResponseDto,
  ApiErrorResponseDto,
  EducationResponseDto,
  ExperienceResponseDto,
  SkillResponseDto,
  CertificateResponseDto,
  ProjectResponseDto,
)
@Roles(SystemRole.CANDIDATE)
@Controller()
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post(['educations', 'education'])
  @ApiOperation({ summary: 'Add an education block to my profile' })
  @ApiCreatedResponse({ schema: PROFILE_ENVELOPE })
  createEducation(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEducationDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.createEducation(user.id, dto);
  }

  @Put(['educations/:id', 'education/:id'])
  @ApiOperation({ summary: 'Update one of my education blocks' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  updateEducation(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: UpdateEducationDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateEducation(user.id, id, dto);
  }

  @Delete(['educations/:id', 'education/:id'])
  @ApiOperation({ summary: 'Delete one of my education blocks' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  deleteEducation(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.deleteEducation(user.id, id);
  }

  @Post(['experiences', 'experience'])
  @ApiOperation({ summary: 'Add an experience block to my profile' })
  @ApiCreatedResponse({ schema: PROFILE_ENVELOPE })
  createExperience(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateExperienceDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.createExperience(user.id, dto);
  }

  @Put(['experiences/:id', 'experience/:id'])
  @ApiOperation({ summary: 'Update one of my experience blocks' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  updateExperience(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: UpdateExperienceDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateExperience(user.id, id, dto);
  }

  @Delete(['experiences/:id', 'experience/:id'])
  @ApiOperation({ summary: 'Delete one of my experience blocks' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  deleteExperience(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.deleteExperience(user.id, id);
  }

  @Post(['skills', 'skill'])
  @ApiOperation({ summary: 'Add a skill to my profile' })
  @ApiCreatedResponse({ schema: PROFILE_ENVELOPE })
  createSkill(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSkillDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.createSkill(user.id, dto);
  }

  @Put(['skills/:id', 'skill/:id'])
  @ApiOperation({ summary: 'Update one of my skills' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  updateSkill(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: UpdateSkillDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateSkill(user.id, id, dto);
  }

  @Delete(['skills/:id', 'skill/:id'])
  @ApiOperation({ summary: 'Delete one of my skills' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  deleteSkill(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.deleteSkill(user.id, id);
  }

  @Post(['certificates', 'certificate'])
  @ApiOperation({ summary: 'Add a certificate to my profile' })
  @ApiCreatedResponse({ schema: PROFILE_ENVELOPE })
  createCertificate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCertificateDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.createCertificate(user.id, dto);
  }

  @Put(['certificates/:id', 'certificate/:id'])
  @ApiOperation({ summary: 'Update one of my certificates' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  updateCertificate(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: UpdateCertificateDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateCertificate(user.id, id, dto);
  }

  @Delete(['certificates/:id', 'certificate/:id'])
  @ApiOperation({ summary: 'Delete one of my certificates' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  deleteCertificate(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.deleteCertificate(user.id, id);
  }

  @Post(['projects', 'project'])
  @ApiOperation({ summary: 'Add a project to my profile' })
  @ApiCreatedResponse({ schema: PROFILE_ENVELOPE })
  createProject(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProjectDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.createProject(user.id, dto);
  }

  @Put(['projects/:id', 'project/:id'])
  @ApiOperation({ summary: 'Update one of my projects' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  updateProject(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateProject(user.id, id, dto);
  }

  @Delete(['projects/:id', 'project/:id'])
  @ApiOperation({ summary: 'Delete one of my projects' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  deleteProject(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID_PIPE) id: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.deleteProject(user.id, id);
  }

  @Get(':userId')
  @ApiOperation({
    summary:
      'Get my full profile; recruiter access stays fail-closed until authorization contract exists',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  @ApiNotFoundResponse({
    description: 'Profile does not exist',
    type: ApiErrorResponseDto,
  })
  getProfile(
    @CurrentUser() user: AuthUser,
    @Param('userId', UUID_PIPE) userId: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.getProfile(user.id, userId);
  }

  @Put(':userId')
  @ApiOperation({
    summary:
      'Create or merge-update the general fields of my profile',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ schema: PROFILE_ENVELOPE })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Param('userId', UUID_PIPE) userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateProfile(user.id, userId, dto);
  }
}
