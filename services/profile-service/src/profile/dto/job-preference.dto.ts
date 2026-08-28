import { ApiProperty } from '@nestjs/swagger';
import {
  JobPreferenceState,
  PreferredJobType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const CONTROL_CHARACTER_FREE = /^[^\u0000-\u001f\u007f-\u009f]+$/u;
const EXACT_MATCH_LITERAL = /^[^%_\\]+$/u;
const POSTGRES_SAFE_UNICODE = /^(?:[^\u0000\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;
const DECIMAL_STRING = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;

export const JOB_PREFERENCE_SCHEMA_VERSION = 1 as const;
export const JOB_PREFERENCE_CONSENT_VERSION = 1 as const;
export const JOB_PREFERENCE_MAX_VERSION = 2_147_483_647;
export const JOB_PREFERENCE_MAXIMUM_SALARY = '9999999999999.99';

export const JOB_PREFERENCE_V1_JOB_TYPES = [
  PreferredJobType.FULL_TIME,
  PreferredJobType.PART_TIME,
  PreferredJobType.REMOTE,
  PreferredJobType.INTERNSHIP,
] as const;

export enum JobPreferenceProjectionState {
  UNSET = 'UNSET',
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
}

export function canonicalizeJobPreferenceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();
}

export function hasPostgresSafeJobPreferenceUnicode(
  value: string,
): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        next < 0xdc00 ||
        next > 0xdfff
      ) {
        return false;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

const canonicalizeTextArray = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((item) =>
      typeof item === 'string'
        ? canonicalizeJobPreferenceText(item)
        : item,
    )
    : value;

const caseInsensitiveIdentity = (value: unknown): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class PutJobPreferenceDto {
  @ApiProperty({ minimum: 0, maximum: JOB_PREFERENCE_MAX_VERSION })
  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(JOB_PREFERENCE_MAX_VERSION)
  expectedVersion!: number;

  @ApiProperty({ enum: JobPreferenceState })
  @IsDefined()
  @IsEnum(JobPreferenceState)
  state!: JobPreferenceState;

  @ApiProperty({ enum: [JOB_PREFERENCE_CONSENT_VERSION], nullable: true })
  @IsIn([null, JOB_PREFERENCE_CONSENT_VERSION])
  consentVersion!: typeof JOB_PREFERENCE_CONSENT_VERSION | null;

  @ApiProperty({ type: [String], maxItems: 10 })
  @IsDefined()
  @Transform(canonicalizeTextArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  @Matches(CONTROL_CHARACTER_FREE, { each: true })
  @Matches(EXACT_MATCH_LITERAL, { each: true })
  @Matches(POSTGRES_SAFE_UNICODE, { each: true })
  @ArrayUnique(caseInsensitiveIdentity)
  targetRoles!: string[];

  @ApiProperty({ type: [String], maxItems: 5 })
  @IsDefined()
  @Transform(canonicalizeTextArray)
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(1, 255, { each: true })
  @Matches(CONTROL_CHARACTER_FREE, { each: true })
  @Matches(EXACT_MATCH_LITERAL, { each: true })
  @Matches(POSTGRES_SAFE_UNICODE, { each: true })
  @ArrayUnique(caseInsensitiveIdentity)
  preferredLocations!: string[];

  @ApiProperty({
    type: [String],
    enum: [...JOB_PREFERENCE_V1_JOB_TYPES],
    maxItems: 4,
  })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn([...JOB_PREFERENCE_V1_JOB_TYPES], { each: true })
  @ArrayUnique()
  preferredJobTypes!: PreferredJobType[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '20000000.00',
    description:
      'Positive VND amount with at most two decimal places',
  })
  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(DECIMAL_STRING)
  minimumSalary!: string | null;
}

export class JobPreferenceResponseDto {
  @ApiProperty({ enum: [JOB_PREFERENCE_SCHEMA_VERSION] })
  @Equals(JOB_PREFERENCE_SCHEMA_VERSION)
  schemaVersion!: typeof JOB_PREFERENCE_SCHEMA_VERSION;

  @ApiProperty({ format: 'uuid' })
  candidateId!: string;

  @ApiProperty({ enum: JobPreferenceProjectionState })
  state!: JobPreferenceProjectionState;

  @ApiProperty({ minimum: 0, maximum: JOB_PREFERENCE_MAX_VERSION })
  version!: number;

  @ApiProperty({ enum: [JOB_PREFERENCE_CONSENT_VERSION], nullable: true })
  consentVersion!: typeof JOB_PREFERENCE_CONSENT_VERSION | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  consentedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  withdrawnAt!: string | null;

  @ApiProperty({ type: [String], maxItems: 10 })
  targetRoles!: string[];

  @ApiProperty({ type: [String], maxItems: 5 })
  preferredLocations!: string[];

  @ApiProperty({
    type: [String],
    enum: [...JOB_PREFERENCE_V1_JOB_TYPES],
    maxItems: 4,
  })
  preferredJobTypes!: PreferredJobType[];

  @ApiProperty({ type: String, nullable: true, example: '20000000.00' })
  minimumSalary!: string | null;

  @ApiProperty({ enum: ['VND'] })
  currency!: 'VND';

  @ApiProperty({ format: 'date-time', nullable: true })
  createdAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  updatedAt!: string | null;
}
