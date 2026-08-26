import { ApiProperty } from '@nestjs/swagger';

export class EducationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  school!: string;

  @ApiProperty({ nullable: true })
  major!: string | null;

  @ApiProperty({ nullable: true })
  degree!: string | null;

  @ApiProperty({ format: 'date' })
  startDate!: string;

  @ApiProperty({ nullable: true, format: 'date' })
  endDate!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class ExperienceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  companyName!: string;

  @ApiProperty()
  position!: string;

  @ApiProperty({ format: 'date' })
  startDate!: string;

  @ApiProperty({ nullable: true, format: 'date' })
  endDate!: string | null;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class SkillResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  level!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class CertificateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  issuer!: string;

  @ApiProperty({ format: 'date' })
  issuedAt!: string;

  @ApiProperty({ nullable: true, format: 'uri' })
  credentialUrl!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class ProjectResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  role!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true, format: 'uri' })
  url!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class ProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ nullable: true })
  fullName!: string | null;

  @ApiProperty({ nullable: true })
  headline!: string | null;

  @ApiProperty({ nullable: true })
  summary!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  avatarFileId!: string | null;

  @ApiProperty({ nullable: true, format: 'uri' })
  avatarUrl!: string | null;

  @ApiProperty({ nullable: true, format: 'uri' })
  githubUrl!: string | null;

  @ApiProperty({ nullable: true, format: 'uri' })
  linkedinUrl!: string | null;

  @ApiProperty({ nullable: true, format: 'uri' })
  portfolioUrl!: string | null;

  @ApiProperty({ minimum: 0, maximum: 100 })
  completionPercent!: number;

  @ApiProperty({ minimum: 1 })
  completionRuleVersion!: number;

  @ApiProperty({
    description:
      'True below 50 percent; this warning never blocks an application',
  })
  completionWarning!: boolean;

  @ApiProperty({ type: [String] })
  missingSections!: string[];

  @ApiProperty({ minimum: 1 })
  aggregateVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: [EducationResponseDto] })
  educations!: EducationResponseDto[];

  @ApiProperty({ type: [ExperienceResponseDto] })
  experiences!: ExperienceResponseDto[];

  @ApiProperty({ type: [SkillResponseDto] })
  skills!: SkillResponseDto[];

  @ApiProperty({ type: [CertificateResponseDto] })
  certificates!: CertificateResponseDto[];

  @ApiProperty({ type: [ProjectResponseDto] })
  projects!: ProjectResponseDto[];
}
