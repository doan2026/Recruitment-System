import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsByteLength,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const COMPANY_PUBLIC_SEARCH_DEFAULT_LIMIT = 20;
export const COMPANY_PUBLIC_SEARCH_MAX_LIMIT = 50;
export const COMPANY_PUBLIC_SEARCH_MAX_CURSOR_LENGTH = 1_024;

const PRINTABLE_ASCII_PATTERN = /^[\x21-\x7e]+$/;

export function canonicalizePublicCompanySearchQuery(
  value: unknown,
): unknown {
  if (typeof value !== 'string') return value;
  return value
    .normalize('NFKC')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();
}

export class PublicCompanySearchQueryDto {
  @ApiPropertyOptional({
    description: 'Company-name search text',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }) => canonicalizePublicCompanySearchQuery(value))
  @IsString()
  @Length(1, 100)
  @Matches(/^[^\p{Cc}\p{Cf}]*$/u)
  q?: string;

  @ApiPropertyOptional({
    description: 'Opaque keyset-pagination cursor',
    minLength: 1,
    maxLength: COMPANY_PUBLIC_SEARCH_MAX_CURSOR_LENGTH,
  })
  @IsOptional()
  @IsString()
  @IsByteLength(1, COMPANY_PUBLIC_SEARCH_MAX_CURSOR_LENGTH)
  @Matches(PRINTABLE_ASCII_PATTERN)
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: COMPANY_PUBLIC_SEARCH_MAX_LIMIT,
    default: COMPANY_PUBLIC_SEARCH_DEFAULT_LIMIT,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COMPANY_PUBLIC_SEARCH_MAX_LIMIT)
  limit = COMPANY_PUBLIC_SEARCH_DEFAULT_LIMIT;
}

export class PublicCompanySearchItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  slug!: string;

  @ApiProperty()
  @IsString()
  industry!: string;

  @ApiProperty()
  @IsString()
  size!: string;

  @ApiProperty()
  @IsString()
  address!: string;

  @ApiProperty({ nullable: true, format: 'uri' })
  @IsOptional()
  @IsString()
  logoUrl!: string | null;
}

export { PublicCompanySearchItemDto as PublicCompanySearchSummaryDto };

export class PublicCompanySearchMetaDto {
  @ApiProperty({ minimum: 1, maximum: COMPANY_PUBLIC_SEARCH_MAX_LIMIT })
  @IsInt()
  @Min(1)
  @Max(COMPANY_PUBLIC_SEARCH_MAX_LIMIT)
  limit!: number;

  @ApiProperty()
  @IsBoolean()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, minLength: 1, maxLength: 1_024 })
  @IsOptional()
  @IsString()
  @IsByteLength(1, COMPANY_PUBLIC_SEARCH_MAX_CURSOR_LENGTH)
  @Matches(PRINTABLE_ASCII_PATTERN)
  nextCursor!: string | null;
}
