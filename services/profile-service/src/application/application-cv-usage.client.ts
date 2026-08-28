export interface ApplicationCvUsage {
  readonly candidateId: string;
  readonly cvId: string;
  readonly used: boolean;
  readonly firstUsedAt: string | null;
  readonly applicationCount: number;
}

export type CvDeletionFenceDisposition = 'FENCED' | 'USED';

export interface ApplicationCvDeletionFence {
  readonly candidateId: string;
  readonly cvId: string;
  readonly deletionRequestId: string;
  readonly disposition: CvDeletionFenceDisposition;
  readonly fencedAt: string | null;
  readonly firstUsedAt: string | null;
  readonly applicationCount: number;
}

export abstract class ApplicationCvUsageClient {
  abstract lookup(
    candidateId: string,
    cvId: string,
  ): Promise<ApplicationCvUsage>;

  abstract acquireDeletionFence(
    candidateId: string,
    cvId: string,
    deletionRequestId: string,
  ): Promise<ApplicationCvDeletionFence>;
}
