import { JobStatus, JobType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateJobDto {
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 20000)
  description!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 20000)
  requirements!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 20000)
  benefits!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salaryMax?: number;

  @ApiProperty()
  @IsBoolean()
  isNegotiable!: boolean;

  @ApiPropertyOptional({ default: 'VND', minLength: 3, maxLength: 3 })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency = 'VND';

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Length(1, 255)
  location!: string;

  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType!: JobType;

  @ApiProperty({ minimum: 0, maximum: 60 })
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears!: number;

  @ApiProperty({ minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  skills!: string[];

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  deadline!: string;
}

export class UpdateJobDto extends PartialType(CreateJobDto) {}

export class RejectJobDto {
  @ApiProperty({ minLength: 3, maxLength: 1000 })
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class JobDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) companyId!: string;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() requirements!: string;
  @ApiProperty() benefits!: string;
  @ApiPropertyOptional({ nullable: true }) salaryMin!: string | null;
  @ApiPropertyOptional({ nullable: true }) salaryMax!: string | null;
  @ApiProperty() isNegotiable!: boolean;
  @ApiProperty() currency!: string;
  @ApiProperty() location!: string;
  @ApiProperty({ enum: JobType }) jobType!: JobType;
  @ApiProperty() experienceYears!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty({ format: 'date' }) deadline!: string;
  @ApiProperty({ enum: JobStatus }) status!: JobStatus;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  publishedAt!: string | null;
  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  reviewedBy!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  reviewedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
