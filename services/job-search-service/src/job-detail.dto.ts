import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { JobStatus, JobType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import { JobAvailabilityReason } from './job-availability.dto';

export const MAX_BULK_JOB_DETAIL_IDS = 100;

export class BulkJobDetailRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: MAX_BULK_JOB_DETAIL_IDS,
    uniqueItems: true,
  })
  // PostgreSQL returns ids in lowercase; normalize before the uniqueness
  // check so 'ABC…' and 'abc…' are one id and still resolve to the job.
  @Transform(({ value }: { value: unknown }) => Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.toLowerCase() : item)
    : value)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_JOB_DETAIL_IDS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  jobIds!: string[];
}

export class JobDetailDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) companyId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() requirements!: string;
  @ApiProperty() benefits!: string;
  @ApiProperty({ nullable: true }) salaryMin!: string | null;
  @ApiProperty({ nullable: true }) salaryMax!: string | null;
  @ApiProperty() isNegotiable!: boolean;
  @ApiProperty() currency!: string;
  @ApiProperty() location!: string;
  @ApiProperty({ enum: JobType }) jobType!: JobType;
  @ApiProperty() experienceYears!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty({ format: 'date' }) deadline!: string;
  @ApiProperty({ enum: JobStatus }) status!: JobStatus;
  @ApiProperty({ nullable: true, format: 'date-time' })
  publishedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() acceptingApplications!: boolean;
  @ApiProperty({ enum: JobAvailabilityReason, nullable: true })
  availabilityReason!: JobAvailabilityReason | null;
}

export class BulkJobDetailResultDto {
  @ApiProperty({ type: [JobDetailDto] }) items!: JobDetailDto[];
  @ApiProperty({ type: [String], format: 'uuid' })
  unavailableJobIds!: string[];
}
