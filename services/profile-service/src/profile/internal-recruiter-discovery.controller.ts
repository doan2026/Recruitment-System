import {
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  InternalCallers,
  InternalOnly,
} from '../common/auth/auth.decorators';
import {
  RecruiterDiscoveryResolveRequestDto,
  RecruiterDiscoveryResolvedDto,
  RecruiterDiscoverySnapshotDto,
  RecruiterDiscoverySnapshotRequestDto,
} from './dto/recruiter-discovery.dto';
import { RecruiterDiscoveryService } from './recruiter-discovery.service';

@ApiExcludeController()
@InternalOnly()
@InternalCallers('job-search-service')
@Controller('internal/v1/recruiter-discovery')
export class InternalRecruiterDiscoveryController {
  constructor(private readonly discovery: RecruiterDiscoveryService) {}

  @Post('snapshot')
  @HttpCode(200)
  snapshot(
    @Body() _request: RecruiterDiscoverySnapshotRequestDto,
  ): Promise<RecruiterDiscoverySnapshotDto> {
    return this.discovery.snapshot();
  }

  @Post('resolve')
  @HttpCode(200)
  resolve(
    @Body() request: RecruiterDiscoveryResolveRequestDto,
  ): Promise<RecruiterDiscoveryResolvedDto> {
    return this.discovery.resolve(request);
  }
}
