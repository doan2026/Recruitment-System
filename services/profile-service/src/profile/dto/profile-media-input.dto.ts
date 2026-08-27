import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';

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
