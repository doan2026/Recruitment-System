import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CandidateDiscoveryEligibility,
} from './profile-candidate-discovery-client.service';
import {
  RecruiterCandidateRecommendationQueryDto,
} from './recruiter-candidate-recommendation.dto';
import {
  configuredServiceUrl,
  configuredTimeout,
  hasExactKeys,
  isPlainObject,
  isUuidV4,
  readBoundedJson,
} from './recommendation-http';

const CALLER_SERVICE = 'job-search-service';
const ENVELOPE_KEYS = ['data', 'meta'] as const;
const DATA_KEYS = ['job_id', 'items', 'next_cursor', 'reason'] as const;
const ITEM_KEYS = ['candidate_id', 'score'] as const;
const CURSOR_ERROR_KEYS = ['code', 'message', 'details'] as const;
const CURSOR_STALE_CODE = 'RECOMMENDATION_CURSOR_STALE';
const MAX_ELIGIBLE_CANDIDATES = 500;
const MAX_VERSION = 2_147_483_647;

export enum AiCandidateRecommendationReason {
  JOB_EMBEDDING_NOT_FOUND = 'JOB_EMBEDDING_NOT_FOUND',
  JOB_EMBEDDING_INACTIVE = 'JOB_EMBEDDING_INACTIVE',
  NO_ACTIVE_CV_EMBEDDINGS = 'NO_ACTIVE_CV_EMBEDDINGS',
  EMBEDDING_MODEL_MISMATCH = 'EMBEDDING_MODEL_MISMATCH',
  NO_MATCHING_CV_EMBEDDINGS = 'NO_MATCHING_CV_EMBEDDINGS',
}

export interface AiCandidateRecommendationItem {
  candidateId: string;
  score: number;
}

export interface AiCandidateRecommendationResult {
  items: AiCandidateRecommendationItem[];
  nextCursor: string | null;
  reason: AiCandidateRecommendationReason | null;
}

export class AiCandidateRecommendationUnavailableError extends Error {
  constructor() {
    super('AI_CANDIDATE_RECOMMENDATION_UNAVAILABLE');
    this.name = 'AiCandidateRecommendationUnavailableError';
  }
}

export class AiCandidateRecommendationInvalidResponseError extends Error {
  constructor() {
    super('AI_CANDIDATE_RECOMMENDATION_RESPONSE_INVALID');
    this.name = 'AiCandidateRecommendationInvalidResponseError';
  }
}

export class AiCandidateRecommendationCursorStaleError extends Error {
  constructor() {
    super(CURSOR_STALE_CODE);
    this.name = 'AiCandidateRecommendationCursorStaleError';
  }
}

@Injectable()
export class AiCandidateRecommendationClientService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly internalApiKey: string | undefined;
  private readonly jobRecommendationApiKey: string | undefined;

  constructor(config: ConfigService) {
    this.baseUrl = configuredServiceUrl(
      config,
      'AI_SERVICE_URL',
      'AI_SERVICE_ALLOWED_HOSTS',
      'http://ai-service:8000',
    );
    this.timeoutMs = configuredTimeout(config, 'AI_REQUEST_TIMEOUT_MS');
    this.internalApiKey = config.get<string>('AI_CANDIDATE_INTERNAL_API_KEY');
    this.jobRecommendationApiKey = config.get<string>('AI_INTERNAL_API_KEY');
  }

  isConfigured(): boolean {
    return this.configuredApiKey() !== undefined;
  }

  async recommendCandidates(
    jobId: string,
    jobVersion: number,
    eligibleCandidates: readonly CandidateDiscoveryEligibility[],
    query: RecruiterCandidateRecommendationQueryDto,
  ): Promise<AiCandidateRecommendationResult> {
    const internalApiKey = this.configuredApiKey();
    if (
      !this.isCanonicalUuid(jobId) ||
      !Number.isSafeInteger(jobVersion) ||
      jobVersion < 1 ||
      jobVersion > MAX_VERSION ||
      !internalApiKey ||
      eligibleCandidates.length < 1 ||
      eligibleCandidates.length > MAX_ELIGIBLE_CANDIDATES ||
      !this.isCanonicalEligibility(eligibleCandidates) ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 50 ||
      (
        query.cursor !== undefined &&
        (
          typeof query.cursor !== 'string' ||
          Buffer.byteLength(query.cursor, 'utf8') < 1 ||
          Buffer.byteLength(query.cursor, 'utf8') > 1_024
        )
      )
    ) {
      throw new AiCandidateRecommendationUnavailableError();
    }
    const request: Record<string, unknown> = {
      job_id: jobId,
      job_version: jobVersion,
      eligible_candidates: eligibleCandidates.map((candidate) => ({
        candidate_id: candidate.candidateId,
        cv_id: candidate.cvId,
        discovery_version: candidate.discoveryVersion,
        profile_version: candidate.profileVersion,
      })),
      limit: query.limit,
    };
    if (query.cursor !== undefined) request.cursor = query.cursor;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/recommend/candidates`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-internal-api-key': internalApiKey,
          'x-internal-service': CALLER_SERVICE,
        },
        body: JSON.stringify(request),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AiCandidateRecommendationUnavailableError();
    }
    if (response.status === 409) {
      await this.handleCursorError(response, query.cursor !== undefined);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiCandidateRecommendationUnavailableError();
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new AiCandidateRecommendationInvalidResponseError();
    }
    return this.validateResponse(
      body,
      jobId,
      query.limit,
      new Set(eligibleCandidates.map(({ candidateId }) => candidateId)),
    );
  }

  private async handleCursorError(
    response: Response,
    isContinuation: boolean,
  ): Promise<never> {
    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new AiCandidateRecommendationInvalidResponseError();
    }
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, CURSOR_ERROR_KEYS) ||
      body.code !== CURSOR_STALE_CODE ||
      typeof body.message !== 'string' ||
      body.message.length < 1 ||
      body.message.length > 256 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(body.message) ||
      body.details !== null
    ) {
      throw new AiCandidateRecommendationInvalidResponseError();
    }
    if (!isContinuation) {
      throw new AiCandidateRecommendationInvalidResponseError();
    }
    throw new AiCandidateRecommendationCursorStaleError();
  }

  private validateResponse(
    body: unknown,
    jobId: string,
    limit: number,
    eligibleCandidateIds: ReadonlySet<string>,
  ): AiCandidateRecommendationResult {
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, ENVELOPE_KEYS) ||
      body.meta !== null ||
      !isPlainObject(body.data) ||
      !hasExactKeys(body.data, DATA_KEYS) ||
      !this.isCanonicalUuid(body.data.job_id) ||
      body.data.job_id !== jobId ||
      !Array.isArray(body.data.items) ||
      body.data.items.length > limit
    ) {
      throw new AiCandidateRecommendationInvalidResponseError();
    }
    const reason = body.data.reason;
    if (
      reason !== null &&
      !Object.values(AiCandidateRecommendationReason).includes(
        reason as AiCandidateRecommendationReason,
      )
    ) {
      throw new AiCandidateRecommendationInvalidResponseError();
    }
    const nextCursor = body.data.next_cursor;
    if (
      nextCursor !== null &&
      (
        typeof nextCursor !== 'string' ||
        Buffer.byteLength(nextCursor, 'utf8') < 1 ||
        Buffer.byteLength(nextCursor, 'utf8') > 1024
      )
    ) {
      throw new AiCandidateRecommendationInvalidResponseError();
    }

    let previousScore = Number.POSITIVE_INFINITY;
    let previousCandidateId = '';
    const seen = new Set<string>();
    const items = body.data.items.map((value): AiCandidateRecommendationItem => {
      if (
        !isPlainObject(value) ||
        !hasExactKeys(value, ITEM_KEYS) ||
        !this.isCanonicalUuid(value.candidate_id) ||
        !eligibleCandidateIds.has(value.candidate_id) ||
        seen.has(value.candidate_id) ||
        typeof value.score !== 'number' ||
        !Number.isFinite(value.score) ||
        value.score < 0 ||
        value.score > 1 ||
        value.score > previousScore ||
        (
          value.score === previousScore &&
          previousCandidateId !== '' &&
          value.candidate_id <= previousCandidateId
        )
      ) {
        throw new AiCandidateRecommendationInvalidResponseError();
      }
      seen.add(value.candidate_id);
      previousScore = value.score;
      previousCandidateId = value.candidate_id;
      return { candidateId: value.candidate_id, score: value.score };
    });
    if (
      (items.length > 0) === (reason !== null) ||
      (items.length === 0 && nextCursor !== null)
    ) {
      throw new AiCandidateRecommendationInvalidResponseError();
    }
    return {
      items,
      nextCursor: nextCursor as string | null,
      reason: reason as AiCandidateRecommendationReason | null,
    };
  }

  private isCanonicalUuid(value: unknown): value is string {
    return isUuidV4(value) && value === value.toLowerCase();
  }

  private isCanonicalEligibility(
    candidates: readonly CandidateDiscoveryEligibility[],
  ): boolean {
    const candidateIds = candidates.map(({ candidateId }) => candidateId);
    const cvIds = candidates.map(({ cvId }) => cvId);
    return candidates.every((candidate) =>
      this.isCanonicalUuid(candidate.candidateId) &&
      this.isCanonicalUuid(candidate.cvId) &&
      Number.isSafeInteger(candidate.discoveryVersion) &&
      candidate.discoveryVersion >= 1 &&
      candidate.discoveryVersion <= MAX_VERSION &&
      Number.isSafeInteger(candidate.profileVersion) &&
      candidate.profileVersion >= 1 &&
      candidate.profileVersion <= MAX_VERSION
    ) &&
      candidateIds.every((candidateId, index) =>
        index === 0 || candidateIds[index - 1] < candidateId
      ) &&
      new Set(candidateIds).size === candidateIds.length &&
      new Set(cvIds).size === cvIds.length;
  }

  private configuredApiKey(): string | undefined {
    const value = this.internalApiKey;
    const byteLength = value ? Buffer.byteLength(value, 'utf8') : 0;
    return value &&
      value !== this.jobRecommendationApiKey &&
      !value.toLowerCase().includes('replace-with') &&
      byteLength >= 32 &&
      byteLength <= 512 &&
      /^[\x21-\x7e]+$/.test(value)
      ? value
      : undefined;
  }
}
