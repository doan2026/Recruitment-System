import {
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth-user.interface';
import {
  CurrentUser,
  InternalCandidateJwt,
  InternalOnly,
  Roles,
} from '../common/auth/auth.decorators';
import { SystemRole } from '../common/auth/system-role.enum';
import { VerifyInternalCvRequestDto } from './dto/internal-cv.dto';
import { InternalCvVerificationV2Dto } from './dto/internal-cv-v2.dto';
import { InternalCvV2Service } from './internal-cv-v2.service';

@ApiExcludeController()
@InternalOnly()
@Controller('internal/v2')
export class InternalCvV2Controller {
  constructor(private readonly cvs: InternalCvV2Service) {}

  @Post('cvs/verify')
  @HttpCode(200)
  @InternalCandidateJwt()
  @Roles(SystemRole.CANDIDATE)
  verify(
    @CurrentUser() candidate: AuthUser,
    @Body() request: VerifyInternalCvRequestDto,
  ): Promise<InternalCvVerificationV2Dto> {
    return this.cvs.verifyCandidateCv(candidate.id, request);
  }
}
