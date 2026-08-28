import { Type } from 'class-transformer';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { CompanyMediaReferenceDto } from './company-media-reference.dto';
import { CreateCompanyDto } from './create-company.dto';
import { FileReferenceDto } from './file-reference.dto';

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
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
