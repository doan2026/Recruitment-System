import {
  CompanyMediaType,
  CompanyVerificationStatus,
} from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LogoReferenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty({ format: 'uri' })
  url!: string;
}

export class CompanyMediaResponseDto extends LogoReferenceResponseDto {
  @ApiProperty({ enum: CompanyMediaType })
  type!: CompanyMediaType;

  @ApiProperty({ minimum: 0 })
  sortOrder!: number;
}

export class CompanyProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  industry!: string;

  @ApiProperty()
  size!: string;

  @ApiProperty()
  address!: string;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  website!: string | null;

  @ApiProperty()
  taxCode!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: LogoReferenceResponseDto,
  })
  logo!: LogoReferenceResponseDto | null;

  @ApiProperty({ type: [CompanyMediaResponseDto] })
  media!: CompanyMediaResponseDto[];

  @ApiProperty({ enum: CompanyVerificationStatus })
  verifiedStatus!: CompanyVerificationStatus;

  @ApiPropertyOptional({ nullable: true })
  rejectReason!: string | null;

  @ApiProperty({ minimum: 0 })
  aggregateVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
