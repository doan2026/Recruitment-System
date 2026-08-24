import { CompanyMediaType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicCompanyMediaDto {
  @ApiProperty({ format: 'uri' })
  url!: string;

  @ApiProperty({ enum: CompanyMediaType })
  type!: CompanyMediaType;

  @ApiProperty({ minimum: 0 })
  sortOrder!: number;
}

export class PublicCompanyProfileDto {
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

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  logoUrl!: string | null;

  @ApiProperty({ type: [PublicCompanyMediaDto] })
  media!: PublicCompanyMediaDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
