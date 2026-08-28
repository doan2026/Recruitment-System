export interface CurrentRecruiterIdentity {
  readonly id: string;
  readonly normalizedEmail: string;
}

export abstract class CurrentAuthAccountClient {
  abstract getCurrentRecruiter(
    accessToken: string,
    expectedUserId: string,
  ): Promise<CurrentRecruiterIdentity>;
}
