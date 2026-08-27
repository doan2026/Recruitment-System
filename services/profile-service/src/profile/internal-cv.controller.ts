import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthUser } from '../common/auth/auth-user.interface';
import {
  CurrentUser,
  InternalCandidateJwt,
  InternalOnly,
  Roles,
} from '../common/auth/auth.decorators';
import { SystemRole } from '../common/auth/system-role.enum';
import {
  InternalCvDownloadDto,
  InternalCvDto,
  InternalCvVerificationDto,
  VerifyInternalCvRequestDto,
} from './dto/internal-cv.dto';
import { InternalCvService } from './internal-cv.service';

const UUID_PIPE = new ParseUUIDPipe({ version: '4' });

@ApiExcludeController()
@InternalOnly()
@Controller('internal/v1')
export class InternalCvController {
  constructor(private readonly cvs: InternalCvService) {}

  @Post('cvs/verify')
  @HttpCode(200)
  @InternalCandidateJwt()
  @Roles(SystemRole.CANDIDATE)
  verify(
    @CurrentUser() candidate: AuthUser,
    @Body() request: VerifyInternalCvRequestDto,
  ): Promise<InternalCvVerificationDto> {
    return this.cvs.verifyCandidateCv(candidate.id, request);
  }

  @Get('candidates/:candidateId/cvs')
  list(
    @Param('candidateId', UUID_PIPE) candidateId: string,
  ): Promise<InternalCvDto[]> {
    return this.cvs.listCandidateCvs(candidateId);
  }

  @Get('candidates/:candidateId/cvs/:cvId')
  detail(
    @Param('candidateId', UUID_PIPE) candidateId: string,
    @Param('cvId', UUID_PIPE) cvId: string,
  ): Promise<InternalCvDto> {
    return this.cvs.getCandidateCv(candidateId, cvId);
  }

  @Post('candidates/:candidateId/cvs/:cvId/download-url')
  @HttpCode(200)
  async download(
    @Param('candidateId', UUID_PIPE) candidateId: string,
    @Param('cvId', UUID_PIPE) cvId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InternalCvDownloadDto> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    return this.cvs.createDownloadUrl(candidateId, cvId);
  }
}
