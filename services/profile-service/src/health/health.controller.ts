import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/auth.decorators';
import { JwtVerifierService } from '../common/auth/jwt-verifier.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtVerifier: JwtVerifierService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Check Profile Service and PostgreSQL readiness' })
  @ApiOkResponse({
    schema: {
      example: {
        data: { service: 'profile-service', status: 'UP' },
        meta: null,
      },
    },
  })
  async health(): Promise<{ service: string; status: string }> {
    this.jwtVerifier.assertConfiguration();
    await this.prisma.$queryRaw`SELECT 1`;
    return { service: 'profile-service', status: 'UP' };
  }
}
