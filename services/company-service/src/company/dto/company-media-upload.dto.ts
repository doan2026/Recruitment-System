import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';
import { CompanyMediaAssetType } from '../../media/company-media.client';

export class CreateCompanyMediaUploadDto {
  @ApiProperty({ enum: CompanyMediaAssetType })
  @IsEnum(CompanyMediaAssetType)
  type!: CompanyMediaAssetType;

  @ApiProperty({ minLength: 1, maxLength: 255, example: 'company-logo.png' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalFilename!: string;
}

export class CompanyMediaUploadCapabilityDto {
  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty({ format: 'uri' })
  uploadUrl!: string;

  @ApiProperty()
  cloudName!: string;

  @ApiProperty()
  apiKey!: string;

  @ApiProperty({ enum: ['image', 'video'] })
  resourceType!: 'image' | 'video';

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ minimum: 1 })
  maxBytes!: number;

  @ApiProperty({ type: [String] })
  allowedFormats!: readonly string[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  params!: Record<string, string | number>;

  @ApiProperty()
  signature!: string;
}

export class ConfirmCompanyMediaUploadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fileId!: string;

  @ApiProperty({ enum: CompanyMediaAssetType })
  @IsEnum(CompanyMediaAssetType)
  type!: CompanyMediaAssetType;
}

export class CompanyMediaUploadResultDto {
  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty({ enum: CompanyMediaAssetType })
  type!: CompanyMediaAssetType;

  @ApiProperty({ format: 'uri' })
  url!: string;
}
