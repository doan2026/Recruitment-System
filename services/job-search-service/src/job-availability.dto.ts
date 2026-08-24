import { JobStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum JobAvailabilityReason {
  NOT_FOUND = 'NOT_FOUND',
  NOT_PUBLISHED = 'NOT_PUBLISHED',
  DEADLINE_PASSED = 'DEADLINE_PASSED',
}

export class JobAvailabilityDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty()
  exists!: boolean;

  @ApiProperty()
  acceptingApplications!: boolean;

  @ApiPropertyOptional({
    enum: JobAvailabilityReason,
    nullable: true,
  })
  reason!: JobAvailabilityReason | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  companyId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  recruiterId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  jobTitle!: string | null;

  @ApiPropertyOptional({ enum: JobStatus, nullable: true })
  status!: JobStatus | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  deadline!: string | null;
}
