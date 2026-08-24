import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';
import { CompanyMediaReferenceDto } from './company-media-reference.dto';
import { FileReferenceDto } from './file-reference.dto';

export class CreateCompanyDto {
  @ApiProperty({ minLength: 2, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(2, 160)
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: 10000 })
  @Trim()
  @IsString()
  @Length(1, 10000)
  description!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @Trim()
  @IsString()
  @Length(1, 120)
  industry!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 50,
    description: 'Free-form company size because the domain enum is not fixed yet',
  })
  @Trim()
  @IsString()
  @Length(1, 50)
  size!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Trim()
  @IsString()
  @Length(1, 500)
  address!: string;

  @ApiPropertyOptional({ nullable: true, format: 'uri', maxLength: 2048 })
  @IsOptional()
  @Trim()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  website?: string | null;

  @ApiProperty({
    minLength: 1,
    maxLength: 32,
    description: 'Stored as text so leading zeroes are preserved',
  })
  @Trim()
  @IsString()
  @Length(1, 32)
  taxCode!: string;

  @ApiPropertyOptional({ type: FileReferenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FileReferenceDto)
  logo?: FileReferenceDto;

  @ApiPropertyOptional({
    type: [CompanyMediaReferenceDto],
    maxItems: 11,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(11)
  @ValidateNested({ each: true })
  @Type(() => CompanyMediaReferenceDto)
  media?: CompanyMediaReferenceDto[];
}
