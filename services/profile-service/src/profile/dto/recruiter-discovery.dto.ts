import { ApiProperty } from '@nestjs/swagger';
import { RecruiterDiscoveryState } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const RECRUITER_DISCOVERY_SCHEMA_VERSION = 1 as const;
export const RECRUITER_DISCOVERY_CONSENT_VERSION = 1 as const;
export const RECRUITER_DISCOVERY_MAX_VERSION = 2_147_483_647;
export const RECRUITER_DISCOVERY_PURPOSE =
  'RECRUITER_JOB_RECOMMENDATION' as const;
export const RECRUITER_DISCOVERY_SHARED_FIELDS = Object.freeze([
  'FULL_NAME',
  'HEADLINE',
  'SKILLS',
] as const);
export const RECRUITER_DISCOVERY_SNAPSHOT_LIMIT = 500;
export const RECRUITER_DISCOVERY_RESOLVE_LIMIT = 50;

export enum RecruiterDiscoveryProjectionState {
  UNSET = 'UNSET',
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
}

const canonicalUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class PutRecruiterDiscoveryDto {
  @ApiProperty({ minimum: 0, maximum: RECRUITER_DISCOVERY_MAX_VERSION })
  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(RECRUITER_DISCOVERY_MAX_VERSION)
  expectedVersion!: number;

  @ApiProperty({ enum: RecruiterDiscoveryState })
  @IsDefined()
  @IsEnum(RecruiterDiscoveryState)
  state!: RecruiterDiscoveryState;

  @ApiProperty({ enum: [RECRUITER_DISCOVERY_PURPOSE] })
  @Equals(RECRUITER_DISCOVERY_PURPOSE)
  purpose!: typeof RECRUITER_DISCOVERY_PURPOSE;

  @ApiProperty({
    enum: [RECRUITER_DISCOVERY_CONSENT_VERSION],
    nullable: true,
  })
  @IsIn([null, RECRUITER_DISCOVERY_CONSENT_VERSION])
  consentVersion!: typeof RECRUITER_DISCOVERY_CONSENT_VERSION | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Transform(canonicalUuid)
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  cvId!: string | null;
}

export class RecruiterDiscoveryResponseDto {
  @ApiProperty({ enum: [RECRUITER_DISCOVERY_SCHEMA_VERSION] })
  schemaVersion!: typeof RECRUITER_DISCOVERY_SCHEMA_VERSION;

  @ApiProperty({ enum: [RECRUITER_DISCOVERY_PURPOSE] })
  purpose!: typeof RECRUITER_DISCOVERY_PURPOSE;

  @ApiProperty({
    type: [String],
    enum: [...RECRUITER_DISCOVERY_SHARED_FIELDS],
  })
  sharedFields!: (typeof RECRUITER_DISCOVERY_SHARED_FIELDS)[number][];

  @ApiProperty({ format: 'uuid' })
  candidateId!: string;

  @ApiProperty({ enum: RecruiterDiscoveryProjectionState })
  state!: RecruiterDiscoveryProjectionState;

  @ApiProperty({ minimum: 0, maximum: RECRUITER_DISCOVERY_MAX_VERSION })
  version!: number;

  @ApiProperty({
    enum: [RECRUITER_DISCOVERY_CONSENT_VERSION],
    nullable: true,
  })
  consentVersion!: typeof RECRUITER_DISCOVERY_CONSENT_VERSION | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  cvId!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  consentedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  withdrawnAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  createdAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  updatedAt!: string | null;
}

export class RecruiterDiscoverySnapshotRequestDto {
  @Equals(RECRUITER_DISCOVERY_SCHEMA_VERSION)
  schemaVersion!: typeof RECRUITER_DISCOVERY_SCHEMA_VERSION;

  @Equals(RECRUITER_DISCOVERY_PURPOSE)
  purpose!: typeof RECRUITER_DISCOVERY_PURPOSE;
}

export class RecruiterDiscoveryExpectedCandidateDto {
  @Transform(canonicalUuid)
  @IsUUID('4')
  candidateId!: string;

  @Transform(canonicalUuid)
  @IsUUID('4')
  cvId!: string;

  @IsInt()
  @Min(1)
  @Max(RECRUITER_DISCOVERY_MAX_VERSION)
  discoveryVersion!: number;

  @IsInt()
  @Min(1)
  @Max(RECRUITER_DISCOVERY_MAX_VERSION)
  profileVersion!: number;
}

const candidateIdentity = (
  value: RecruiterDiscoveryExpectedCandidateDto,
): string => value.candidateId;
const cvIdentity = (
  value: RecruiterDiscoveryExpectedCandidateDto,
): string => value.cvId;

export class RecruiterDiscoveryResolveRequestDto {
  @Equals(RECRUITER_DISCOVERY_SCHEMA_VERSION)
  schemaVersion!: typeof RECRUITER_DISCOVERY_SCHEMA_VERSION;

  @Equals(RECRUITER_DISCOVERY_PURPOSE)
  purpose!: typeof RECRUITER_DISCOVERY_PURPOSE;

  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RECRUITER_DISCOVERY_RESOLVE_LIMIT)
  @ArrayUnique(candidateIdentity)
  @ArrayUnique(cvIdentity)
  @ValidateNested({ each: true })
  @Type(() => RecruiterDiscoveryExpectedCandidateDto)
  candidates!: RecruiterDiscoveryExpectedCandidateDto[];
}

export interface RecruiterDiscoverySnapshotCandidateDto {
  candidateId: string;
  cvId: string;
  discoveryVersion: number;
  profileVersion: number;
}

export interface RecruiterDiscoverySnapshotDto {
  schemaVersion: typeof RECRUITER_DISCOVERY_SCHEMA_VERSION;
  purpose: typeof RECRUITER_DISCOVERY_PURPOSE;
  candidates: RecruiterDiscoverySnapshotCandidateDto[];
}

export interface RecruiterDiscoveryResolvedCandidateDto {
  candidateId: string;
  fullName: string;
  headline: string | null;
  skills: string[];
}

export interface RecruiterDiscoveryResolvedDto {
  schemaVersion: typeof RECRUITER_DISCOVERY_SCHEMA_VERSION;
  purpose: typeof RECRUITER_DISCOVERY_PURPOSE;
  candidates: RecruiterDiscoveryResolvedCandidateDto[];
}
