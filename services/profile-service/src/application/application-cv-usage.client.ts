export interface ApplicationCvUsage {
  readonly candidateId: string;
  readonly cvId: string;
  readonly used: boolean;
  readonly firstUsedAt: string | null;
  readonly applicationCount: number;
}

export abstract class ApplicationCvUsageClient {
  abstract lookup(
    candidateId: string,
    cvId: string,
  ): Promise<ApplicationCvUsage>;
}
