import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { JobType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsByteLength,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Matches,
  Min,
} from 'class-validator';
import { JobSearchItemDto } from './job-search.dto';

export const JOB_RECOMMENDATION_DEFAULT_LIMIT = 10;
export const JOB_RECOMMENDATION_MAX_LIMIT = 50;
export const JOB_RECOMMENDATION_MAX_SALARY = 9_999_999_999_999.99;

export enum JobRecommendationSource {
  AI = 'AI',
  PREFERENCES = 'PREFERENCES',
  LATEST = 'LATEST',
}

export enum JobRecommendationFallbackReason {
  NO_ACTIVE_CV = 'NO_ACTIVE_CV',
  PROFILE_UNAVAILABLE = 'PROFILE_UNAVAILABLE',
  AI_UNAVAILABLE = 'AI_UNAVAILABLE',
  AI_NOT_READY = 'AI_NOT_READY',
  AI_RESPONSE_INVALID = 'AI_RESPONSE_INVALID',
  AI_RESULTS_STALE = 'AI_RESULTS_STALE',
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export function canonicalizeRecommendationLocation(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.normalize('NFKC');
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) return normalized;
  return normalized.replace(/\p{White_Space}+/gu, ' ').trim();
}

export class JobRecommendationQueryDto {
  @ApiHideProperty()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(JOB_RECOMMENDATION_MAX_LIMIT)
  limit = JOB_RECOMMENDATION_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'Opaque AI pagination cursor',
    minLength: 1,
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @IsByteLength(1, 1024)
  cursor?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @IsOptional()
  @Transform(({ value }) => canonicalizeRecommendationLocation(value))
  @IsString()
  @Length(1, 255)
  @Matches(/^[^%_\\\u0000-\u001f\u007f-\u009f]*$/u)
  location?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: JOB_RECOMMENDATION_MAX_SALARY,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(JOB_RECOMMENDATION_MAX_SALARY)
  salaryMin?: number;

  @ApiPropertyOptional({ enum: JobType })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;
}

export class JobRecommendationItemDto extends JobSearchItemDto {
  @ApiProperty({ type: Number, minimum: 0, maximum: 1, nullable: true })
  declare score: number | null;
}

export class JobRecommendationResultDto {
  @ApiProperty({ type: [JobRecommendationItemDto] })
  items!: JobRecommendationItemDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque cursor returned only for AI-ranked results',
  })
  nextCursor!: string | null;

  @ApiProperty({ enum: JobRecommendationSource })
  source!: JobRecommendationSource;

  @ApiProperty({
    enum: JobRecommendationFallbackReason,
    nullable: true,
  })
  fallbackReason!: JobRecommendationFallbackReason | null;
}
