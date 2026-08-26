import { ApiProperty } from '@nestjs/swagger';
import {
  FileOwnerType,
  MediaType,
} from '@prisma/client';
import {
  IsEnum,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUploadIntentDto {
  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  type!: MediaType;

  @ApiProperty({ example: 'candidate-cv.pdf', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalFilename!: string;
}

export class ConfirmUploadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fileId!: string;
}

export class InternalCreateUploadIntentDto
  extends CreateUploadIntentDto
{
  @ApiProperty({ enum: FileOwnerType })
  @IsEnum(FileOwnerType)
  ownerType!: FileOwnerType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  ownerId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'User who initiated the domain operation',
  })
  @IsUUID('4')
  requestedBy!: string;
}

export class InternalFileExpectationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fileId!: string;

  @ApiProperty({ enum: FileOwnerType })
  @IsEnum(FileOwnerType)
  expectedOwnerType!: FileOwnerType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  expectedOwnerId!: string;

  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  expectedType!: MediaType;
}

export class BindFileReferenceDto
  extends InternalFileExpectationDto
{
  @ApiProperty({ example: 'CV' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,63}$/)
  referenceType!: string;

  @ApiProperty({ example: 'b6d23349-33a5-4d90-93aa-d0b657417ce9' })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  referenceId!: string;
}
