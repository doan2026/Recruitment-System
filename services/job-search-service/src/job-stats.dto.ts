import { ApiProperty } from '@nestjs/swagger';

export class ActiveJobStatsDto {
  @ApiProperty({ format: 'uuid' })
  companyId!: string;

  @ApiProperty({ minimum: 0 })
  activeJobCount!: number;
}
