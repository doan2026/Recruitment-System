import { CompanyVerificationStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Minimal projection for Job & Search indexing. Unlike the public profile it
 * is returned for every verification status: a PUBLISHED job stays public
 * while its company is re-reviewed after a legal-field edit.
 */
export class CompanyIndexingSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: CompanyVerificationStatus })
  verifiedStatus!: CompanyVerificationStatus;
}
