import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompanyMediaReferenceDto } from './company-media-reference.dto';
import { CreateCompanyDto } from './create-company.dto';
import { FileReferenceDto } from './file-reference.dto';

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: FileReferenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FileReferenceDto)
  logo?: FileReferenceDto;

  @ApiPropertyOptional({
    type: [CompanyMediaReferenceDto],
    maxItems: 11,
    description: 'Complete desired gallery; URLs are resolved by Company through Media Service',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(11)
  @ValidateNested({ each: true })
  @Type(() => CompanyMediaReferenceDto)
  media?: CompanyMediaReferenceDto[];

  @ApiPropertyOptional({
    description: 'Set true to remove the current logo reference',
  })
  @IsOptional()
  @IsBoolean()
  removeLogo?: boolean;
}
