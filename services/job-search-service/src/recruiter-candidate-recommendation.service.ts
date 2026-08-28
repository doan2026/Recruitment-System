import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AiCandidateRecommendationClientService,
  AiCandidateRecommendationCursorStaleError,
  AiCandidateRecommendationInvalidResponseError,
  AiCandidateRecommendationReason,
  AiCandidateRecommendationUnavailableError,
} from './ai-candidate-recommendation-client.service';
import { ApiException } from './common';
import { JobService } from './job.service';
import {
  CandidateDiscoveryEligibility,
  ProfileCandidateDiscoveryClientService,
  ProfileCandidateDiscoveryUnavailableError,
} from './profile-candidate-discovery-client.service';
import {
  RecruiterCandidateRecommendationQueryDto,
  RecruiterCandidateRecommendationReason,
  RecruiterCandidateRecommendationResultDto,
} from './recruiter-candidate-recommendation.dto';

const PUBLIC_REASON_BY_AI: Readonly<Record<
  AiCandidateRecommendationReason,
  RecruiterCandidateRecommendationReason
>> = {
  [AiCandidateRecommendationReason.JOB_EMBEDDING_NOT_FOUND]:
    RecruiterCandidateRecommendationReason.JOB_EMBEDDING_NOT_FOUND,
  [AiCandidateRecommendationReason.JOB_EMBEDDING_INACTIVE]:
    RecruiterCandidateRecommendationReason.JOB_EMBEDDING_INACTIVE,
  [AiCandidateRecommendationReason.NO_ACTIVE_CV_EMBEDDINGS]:
    RecruiterCandidateRecommendationReason.NO_ACTIVE_CV_EMBEDDINGS,
  [AiCandidateRecommendationReason.EMBEDDING_MODEL_MISMATCH]:
    RecruiterCandidateRecommendationReason.EMBEDDING_MODEL_MISMATCH,
  [AiCandidateRecommendationReason.NO_MATCHING_CV_EMBEDDINGS]:
    RecruiterCandidateRecommendationReason.NO_MATCHING_CV_EMBEDDINGS,
};

@Injectable()
export class RecruiterCandidateRecommendationService {
  constructor(
    private readonly jobs: JobService,
    private readonly profiles: ProfileCandidateDiscoveryClientService,
    private readonly ai: AiCandidateRecommendationClientService,
  ) {}

  isConfigured(): boolean {
    return this.jobs.isCandidateRecommendationCompanyConfigured() &&
      this.profiles.isConfigured() &&
      this.ai.isConfigured();
  }

  async recommend(
    recruiterId: string,
    authorization: string,
    jobId: string,
    query: RecruiterCandidateRecommendationQueryDto,
    now?: Date,
  ): Promise<RecruiterCandidateRecommendationResultDto> {
    const startedAt = now ?? new Date();
    const authorizedJob = await this.jobs.authorizeCandidateRecommendation(
      recruiterId,
      authorization,
      jobId,
      startedAt,
    );
    const snapshot = await this.getSnapshot();
    if (snapshot.length === 0) {
      if (query.cursor !== undefined) this.throwCursorStale();
      await this.jobs.revalidateCandidateRecommendation(
        authorizedJob,
        authorization,
      );
      return {
        jobId: authorizedJob.jobId,
        items: [],
        nextCursor: null,
        reason:
          RecruiterCandidateRecommendationReason.NO_DISCOVERABLE_CANDIDATES,
      };
    }

    const aiResult = await this.getAiRecommendations(
      authorizedJob.jobId,
      authorizedJob.aggregateVersion,
      snapshot,
      query,
    );
    if (aiResult.items.length === 0) {
      if (aiResult.reason === null) this.throwUnavailable();
      await this.jobs.revalidateCandidateRecommendation(
        authorizedJob,
        authorization,
      );
      return {
        jobId: authorizedJob.jobId,
        items: [],
        nextCursor: null,
        reason: PUBLIC_REASON_BY_AI[aiResult.reason],
      };
    }

    const eligibilityByCandidate = new Map(
      snapshot.map((candidate) => [candidate.candidateId, candidate]),
    );
    const recommendedScope = aiResult.items.map(({ candidateId }) => {
      const candidate = eligibilityByCandidate.get(candidateId);
      if (!candidate) this.throwUnavailable();
      return candidate;
    });
    const resolved = await this.resolveProfiles(recommendedScope);
    if (
      resolved.length !== recommendedScope.length ||
      resolved.some(
        (profile, index) =>
          profile.candidateId !== recommendedScope[index].candidateId,
      )
    ) {
      throw new ApiException(
        'RECOMMENDATION_SCOPE_CHANGED',
        'Candidate discovery scope changed; retry the request',
        HttpStatus.CONFLICT,
      );
    }

    await this.jobs.revalidateCandidateRecommendation(
      authorizedJob,
      authorization,
    );
    return {
      jobId: authorizedJob.jobId,
      items: resolved.map((profile, index) => ({
        candidateId: profile.candidateId,
        fullName: profile.fullName,
        headline: profile.headline,
        skills: profile.skills,
        score: aiResult.items[index].score,
      })),
      nextCursor: aiResult.nextCursor,
      reason: null,
    };
  }

  private async getSnapshot(): Promise<CandidateDiscoveryEligibility[]> {
    try {
      return await this.profiles.getSnapshot();
    } catch (error) {
      if (error instanceof ProfileCandidateDiscoveryUnavailableError) {
        this.throwUnavailable();
      }
      throw error;
    }
  }

  private async resolveProfiles(
    candidates: readonly CandidateDiscoveryEligibility[],
  ) {
    try {
      return await this.profiles.resolve(candidates);
    } catch (error) {
      if (error instanceof ProfileCandidateDiscoveryUnavailableError) {
        this.throwUnavailable();
      }
      throw error;
    }
  }

  private async getAiRecommendations(
    jobId: string,
    jobVersion: number,
    snapshot: readonly CandidateDiscoveryEligibility[],
    query: RecruiterCandidateRecommendationQueryDto,
  ) {
    try {
      return await this.ai.recommendCandidates(
        jobId,
        jobVersion,
        snapshot,
        query,
      );
    } catch (error) {
      if (error instanceof AiCandidateRecommendationCursorStaleError) {
        this.throwCursorStale();
      }
      if (
        error instanceof AiCandidateRecommendationUnavailableError ||
        error instanceof AiCandidateRecommendationInvalidResponseError
      ) {
        this.throwUnavailable();
      }
      throw error;
    }
  }

  private throwUnavailable(): never {
    throw new ApiException(
      'RECOMMENDATION_UNAVAILABLE',
      'Candidate recommendation service is temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private throwCursorStale(): never {
    throw new ApiException(
      'RECOMMENDATION_CURSOR_STALE',
      'Recommendation cursor is stale',
      HttpStatus.CONFLICT,
    );
  }
}
