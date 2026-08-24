import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        data: { service: 'company-service', status: 'UP' },
        meta: null,
      },
    },
  })
  async health(): Promise<{ service: string; status: string }> {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      service: 'company-service',
      status: 'UP',
    };
  }
}
