import {
  CompanyInvitationStatus,
  CompanyMemberRole,
  CompanyVerificationStatus,
} from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CompanyMemberDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: CompanyMemberRole })
  role!: CompanyMemberRole;

  @ApiProperty({ format: 'date-time' })
  joinedAt!: string;
}

export class CompanyInvitationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  companyId!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: CompanyInvitationStatus })
  status!: CompanyInvitationStatus;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CreatedCompanyInvitationDto extends CompanyInvitationDto {
  @ApiProperty({
    description:
      'Returned once. Send it through the email/notification flow; only its SHA-256 hash is stored.',
  })
  invitationToken!: string;
}

export class RecruiterCompanyDto {
  @ApiProperty({ format: 'uuid' })
  companyId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: CompanyVerificationStatus })
  verifiedStatus!: CompanyVerificationStatus;

  @ApiProperty({ enum: CompanyMemberRole })
  memberRole!: CompanyMemberRole;
}

export class RemovedCompanyMemberDto {
  @ApiProperty({ format: 'uuid' })
  removedUserId!: string;
}
