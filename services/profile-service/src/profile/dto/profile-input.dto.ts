import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  CanonicalHttpsUrl,
  IsHttpsUrl,
  IsHttpsUrlForHost,
} from '../../common/validation/https-url.decorator';
import { Trim } from '../../common/validation/trim.decorator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_PATTERN = /^[0-9+(). -]{6,32}$/;

export class UpdateProfileDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 160 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 160)
  fullName?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 200)
  headline?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 5000)
  summary?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 32 })
  @IsOptional()
  @Trim()
  @Matches(PHONE_PATTERN)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 500)
  address?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://github.com/candidate',
  })
  @IsOptional()
  @CanonicalHttpsUrl()
  @IsHttpsUrlForHost('github.com')
  githubUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://www.linkedin.com/in/candidate',
  })
  @IsOptional()
  @CanonicalHttpsUrl()
  @IsHttpsUrlForHost('linkedin.com')
  linkedinUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://candidate.example.com',
  })
  @IsOptional()
  @CanonicalHttpsUrl()
  @IsHttpsUrl()
  portfolioUrl?: string | null;
}

export class CreateEducationDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Trim()
  @IsString()
  @Length(1, 200)
  school!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 160 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 160)
  major?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 120)
  degree?: string | null;

  @ApiProperty({ format: 'date', example: '2021-09-01' })
  @Matches(DATE_PATTERN)
  startDate!: string;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date',
    example: '2025-06-30',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  endDate?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 5000)
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateEducationDto extends PartialType(
  CreateEducationDto,
) {}

export class CreateExperienceDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  companyName!: string;

  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  position!: string;

  @ApiProperty({ format: 'date', example: '2023-07-01' })
  @Matches(DATE_PATTERN)
  startDate!: string;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date',
    example: '2026-08-01',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  endDate?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 5000)
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateExperienceDto extends PartialType(
  CreateExperienceDto,
) {}

export class CreateSkillDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @Trim()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 40 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 40)
  level?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateSkillDto extends PartialType(CreateSkillDto) {}

export class CreateCertificateDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  issuer!: string;

  @ApiProperty({ format: 'date', example: '2025-01-15' })
  @Matches(DATE_PATTERN)
  issuedAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  @IsOptional()
  @CanonicalHttpsUrl()
  @IsHttpsUrl()
  credentialUrl?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateCertificateDto extends PartialType(
  CreateCertificateDto,
) {}

export class CreateProjectDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 160 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 160)
  role?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 5000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  @IsOptional()
  @CanonicalHttpsUrl()
  @IsHttpsUrl()
  url?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
