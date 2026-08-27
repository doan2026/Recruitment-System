import { ApiProperty } from '@nestjs/swagger';

export class UploadedCvResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['UPLOAD'], example: 'UPLOAD' })
  type!: 'UPLOAD';

  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'Always null for private uploaded CVs; request a short-lived download URL from the download endpoint',
  })
  fileUrl!: string | null;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ minimum: 1 })
  aggregateVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CvDownloadResponseDto {
  @ApiProperty({ format: 'uri' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class DeletedCvResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: ['SOFT'], example: 'SOFT' })
  deletionMode!: 'SOFT';

  @ApiProperty({ example: true })
  isDeleted!: true;

  @ApiProperty({ format: 'date-time' })
  deletedAt!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    example: null,
    description:
      'CV selected as the new default, or null when no reassignment was needed or possible',
  })
  replacementDefaultCvId!: string | null;

  @ApiProperty({ minimum: 1 })
  aggregateVersion!: number;
}
