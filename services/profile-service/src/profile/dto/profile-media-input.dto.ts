import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';
import {
  IsCvBuilderContent,
  MAX_CV_BUILDER_CONTENT_BYTES,
} from './cv-builder-content.decorator';

const MAX_AGGREGATE_VERSION = 2_147_483_647;

export class AttachAvatarDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fileId!: string;
}

export class CreateUploadedCvDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  title!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fileId!: string;
}

export class CvVersionPreconditionDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_AGGREGATE_VERSION,
    description:
      'Current CV aggregate version used for optimistic concurrency control',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_AGGREGATE_VERSION)
  expectedAggregateVersion!: number;
}

export class RenameUploadedCvDto extends CvVersionPreconditionDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  title!: string;
}

export class OnlineCvSnapshotDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  title!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$',
  })
  @Trim()
  @IsString()
  @Length(1, 100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
  templateId!: string;

  @ApiProperty({
    enum: [1],
    example: 1,
    description:
      'Version of the builder JSON contract. Only version 1 is accepted.',
  })
  @IsInt()
  @Equals(1)
  contentSchemaVersion!: 1;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: `Versioned builder state, limited to ${MAX_CV_BUILDER_CONTENT_BYTES} UTF-8 bytes`,
  })
  @IsObject()
  @IsCvBuilderContent()
  contentJson!: Record<string, unknown>;

  @ApiProperty({
    format: 'uuid',
    description:
      'Confirmed private PDF uploaded through Media Service for this exact snapshot',
  })
  @IsUUID('4')
  fileId!: string;
}

export class CreateOnlineCvDto extends OnlineCvSnapshotDto {}

export class CreateOnlineCvRevisionDto extends OnlineCvSnapshotDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_AGGREGATE_VERSION,
    description: 'Aggregate version of the active predecessor revision',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_AGGREGATE_VERSION)
  expectedAggregateVersion!: number;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Move the Candidate default to this new revision even when the predecessor was not default',
  })
  @IsOptional()
  @IsBoolean()
  makeDefault?: boolean;
}
