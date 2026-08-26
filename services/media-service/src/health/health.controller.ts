import {
  Controller,
  Get,
  HttpStatus,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/auth.decorators';
import { InternalAuthService } from '../common/auth/internal-auth.service';
import { JwtVerifierService } from '../common/auth/jwt-verifier.service';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { StorageProvider } from '../storage/storage-provider';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtVerifier: JwtVerifierService,
    private readonly internalAuth: InternalAuthService,
    private readonly storage: StorageProvider,
  ) {}

  @Public()
  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  async health(): Promise<{
    service: string;
    status: 'UP';
  }> {
    try {
      this.jwtVerifier.assertConfiguration();
      this.internalAuth.assertConfiguration();
      this.storage.assertConfiguration();
      await this.prisma.$queryRaw`SELECT 1`;
      return { service: 'media-service', status: 'UP' };
    } catch {
      throw new ApiException(
        'MEDIA_NOT_READY',
        'Media Service is not ready',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
