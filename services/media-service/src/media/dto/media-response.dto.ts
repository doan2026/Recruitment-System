import { ApiProperty } from '@nestjs/swagger';
import {
  FileOwnerType,
  FileStatus,
  MediaType,
} from '@prisma/client';

export class UploadCapabilityDto {
  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty({ format: 'uri' })
  uploadUrl!: string;

  @ApiProperty()
  cloudName!: string;

  @ApiProperty()
  apiKey!: string;

  @ApiProperty({ enum: ['image', 'video', 'raw'] })
  resourceType!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty()
  maxBytes!: number;

  @ApiProperty({ type: [String] })
  allowedFormats!: readonly string[];

  @ApiProperty({ type: Object })
  params!: Record<string, string | number>;

  @ApiProperty()
  signature!: string;
}

export class FileMetadataDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: FileOwnerType })
  ownerType!: FileOwnerType;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ enum: MediaType })
  type!: MediaType;

  @ApiProperty({ enum: FileStatus })
  status!: FileStatus;

  @ApiProperty()
  originalFilename!: string;

  @ApiProperty({ nullable: true })
  mimeType!: string | null;

  @ApiProperty({ nullable: true })
  format!: string | null;

  @ApiProperty({ nullable: true })
  bytes!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Only public media has a stable public URL',
  })
  url!: string | null;

  @ApiProperty()
  privateDelivery!: boolean;

  @ApiProperty()
  aggregateVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class FileReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty()
  callerService!: string;

  @ApiProperty()
  referenceType!: string;

  @ApiProperty()
  referenceId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class DownloadUrlDto {
  @ApiProperty({ format: 'uri' })
  url!: string;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'Null for already-public assets',
  })
  expiresAt!: string | null;
}
