import { Type } from 'class-transformer';
import { CompanyVerificationStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListCompaniesQueryDto {
  @ApiPropertyOptional({
    enum: CompanyVerificationStatus,
    default: CompanyVerificationStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(CompanyVerificationStatus)
  verified_status: CompanyVerificationStatus =
    CompanyVerificationStatus.PENDING;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
