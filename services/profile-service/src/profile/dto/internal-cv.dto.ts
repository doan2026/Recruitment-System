import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

const canonicalUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class VerifyInternalCvRequestDto {
  @Transform(canonicalUuid)
  @IsUUID('4')
  candidateId!: string;

  @Transform(canonicalUuid)
  @IsUUID('4')
  cvId!: string;
}

export interface InternalCvDto {
  cvId: string;
  candidateId: string;
  title: string;
  type: 'UPLOAD' | 'ONLINE';
  fileId: string;
  isDefault: boolean;
  isDeleted: boolean;
  firstUsedAt: string | null;
  aggregateVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface InternalCvVerificationDto {
  candidateId: string;
  cvId: string;
  available: boolean;
  cv: InternalCvDto | null;
}

export interface InternalCvDownloadDto {
  candidateId: string;
  cvId: string;
  url: string;
  expiresAt: string;
}
