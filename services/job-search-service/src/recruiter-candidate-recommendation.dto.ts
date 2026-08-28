import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsByteLength,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const RECRUITER_CANDIDATE_RECOMMENDATION_DEFAULT_LIMIT = 10;
export const RECRUITER_CANDIDATE_RECOMMENDATION_MAX_LIMIT = 50;

export enum RecruiterCandidateRecommendationReason {
  NO_DISCOVERABLE_CANDIDATES = 'NO_DISCOVERABLE_CANDIDATES',
  JOB_EMBEDDING_NOT_FOUND = 'JOB_EMBEDDING_NOT_FOUND',
  JOB_EMBEDDING_INACTIVE = 'JOB_EMBEDDING_INACTIVE',
  NO_ACTIVE_CV_EMBEDDINGS = 'NO_ACTIVE_CV_EMBEDDINGS',
  EMBEDDING_MODEL_MISMATCH = 'EMBEDDING_MODEL_MISMATCH',
  NO_MATCHING_CV_EMBEDDINGS = 'NO_MATCHING_CV_EMBEDDINGS',
}

export class RecruiterCandidateRecommendationQueryDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: RECRUITER_CANDIDATE_RECOMMENDATION_MAX_LIMIT,
    default: RECRUITER_CANDIDATE_RECOMMENDATION_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECRUITER_CANDIDATE_RECOMMENDATION_MAX_LIMIT)
  limit = RECRUITER_CANDIDATE_RECOMMENDATION_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'Opaque candidate-recommendation pagination cursor',
    minLength: 1,
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @IsByteLength(1, 1024)
  cursor?: string;
}

export class RecruiterCandidateRecommendationItemDto {
  @ApiProperty({ format: 'uuid' })
  candidateId!: string;

  @ApiProperty({ minLength: 1, maxLength: 160 })
  fullName!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 200 })
  headline!: string | null;

  @ApiProperty({ type: [String], maxItems: 100 })
  skills!: string[];

  @ApiProperty({ type: Number, minimum: 0, maximum: 1 })
  score!: number;
}

export class RecruiterCandidateRecommendationResultDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ type: [RecruiterCandidateRecommendationItemDto] })
  items!: RecruiterCandidateRecommendationItemDto[];

  @ApiProperty({ type: String, nullable: true, maxLength: 1024 })
  nextCursor!: string | null;

  @ApiProperty({
    enum: RecruiterCandidateRecommendationReason,
    nullable: true,
  })
  reason!: RecruiterCandidateRecommendationReason | null;
}
