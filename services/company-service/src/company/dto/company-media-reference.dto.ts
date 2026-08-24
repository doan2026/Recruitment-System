import { CompanyMediaType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { FileReferenceDto } from './file-reference.dto';

export class CompanyMediaReferenceDto extends FileReferenceDto {
  @ApiProperty({ enum: CompanyMediaType })
  @IsEnum(CompanyMediaType)
  type!: CompanyMediaType;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Display order; array position is used when omitted',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
