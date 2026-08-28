import { InternalCvDto } from './internal-cv.dto';

export interface InternalProfileSkillSnapshotDto {
  schemaVersion: 1;
  profileAggregateVersion: number;
  skills: string[];
}

export interface InternalCvVerificationV2Dto {
  candidateId: string;
  cvId: string;
  available: boolean;
  cv: InternalCvDto | null;
  profileSkillSnapshot: InternalProfileSkillSnapshotDto | null;
}
