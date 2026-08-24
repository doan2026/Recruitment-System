import { JobType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export enum JobSearchSort {
  RELEVANCE = 'RELEVANCE',
  NEWEST = 'NEWEST',
  SALARY_DESC = 'SALARY_DESC',
}

export enum JobSearchSource {
  ELASTICSEARCH = 'ELASTICSEARCH',
  POSTGRESQL = 'POSTGRESQL',
}

const toSkills = ({ value }: { value: unknown }): unknown => {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) =>
    typeof item === 'string' ? item.split(',') : item,
  ).map((item) =>
    typeof item === 'string' ? item.normalize('NFKC').trim() : item,
  ).filter(Boolean);
};
const normalizeText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.normalize('NFKC').trim() : value;

export class JobSearchQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @Length(1, 200)
  q?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @Length(1, 255)
  location?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salaryMax?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(toSkills)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears?: number;

  @ApiPropertyOptional({ enum: JobType })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @ApiPropertyOptional({
    enum: JobSearchSort,
    default: JobSearchSort.RELEVANCE,
  })
  @IsOptional()
  @IsEnum(JobSearchSort)
  sort: JobSearchSort = JobSearchSort.RELEVANCE;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class JobSearchItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) companyId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ nullable: true }) salaryMin!: string | null;
  @ApiPropertyOptional({ nullable: true }) salaryMax!: string | null;
  @ApiProperty() isNegotiable!: boolean;
  @ApiProperty() currency!: string;
  @ApiProperty() location!: string;
  @ApiProperty({ enum: JobType }) jobType!: JobType;
  @ApiProperty() experienceYears!: number;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty({ format: 'date' }) deadline!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  publishedAt!: string | null;
  @ApiPropertyOptional({ nullable: true })
  companyName!: string | null;
  @ApiPropertyOptional({ nullable: true })
  score!: number | null;
}

export class JobSearchFacetsDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } })
  locations!: Record<string, number>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } })
  skills!: Record<string, number>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } })
  jobTypes!: Record<string, number>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } })
  companies!: Record<string, number>;
}

export class JobSearchResultDto {
  @ApiProperty({ type: [JobSearchItemDto] })
  items!: JobSearchItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ type: JobSearchFacetsDto })
  facets!: JobSearchFacetsDto;
  @ApiProperty({ enum: JobSearchSource })
  source!: JobSearchSource;
}
