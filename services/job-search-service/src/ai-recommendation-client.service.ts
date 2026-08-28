import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobRecommendationQueryDto,
} from './job-recommendation.dto';
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
const DATA_KEYS = ['cv_id', 'items', 'next_cursor', 'reason'] as const;
const ITEM_KEYS = ['job_id', 'score'] as const;
const CURSOR_STALE_KEYS = ['code', 'message', 'details'] as const;
const CURSOR_STALE_CODE = 'RECOMMENDATION_CURSOR_STALE';

export enum AiRecommendationReason {
  CV_EMBEDDING_NOT_FOUND = 'CV_EMBEDDING_NOT_FOUND',
  CV_EMBEDDING_INACTIVE = 'CV_EMBEDDING_INACTIVE',
  NO_ACTIVE_JOB_EMBEDDINGS = 'NO_ACTIVE_JOB_EMBEDDINGS',
  EMBEDDING_MODEL_MISMATCH = 'EMBEDDING_MODEL_MISMATCH',
  NO_MATCHING_JOB_EMBEDDINGS = 'NO_MATCHING_JOB_EMBEDDINGS',
}

export interface AiRecommendationItem {
  jobId: string;
  score: number;
}

export interface AiRecommendationResult {
  items: AiRecommendationItem[];
  nextCursor: string | null;
  reason: AiRecommendationReason | null;
}

export class AiRecommendationUnavailableError extends Error {
  constructor() {
    super('AI_RECOMMENDATION_UNAVAILABLE');
    this.name = 'AiRecommendationUnavailableError';
  }
}

export class AiRecommendationInvalidResponseError extends Error {
  constructor() {
    super('AI_RECOMMENDATION_RESPONSE_INVALID');
    this.name = 'AiRecommendationInvalidResponseError';
  }
}

export class AiRecommendationCursorStaleError extends Error {
  constructor() {
    super(CURSOR_STALE_CODE);
    this.name = 'AiRecommendationCursorStaleError';
  }
}

@Injectable()
export class AiRecommendationClientService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly internalApiKey: string | undefined;

  constructor(config: ConfigService) {
    this.baseUrl = configuredServiceUrl(
      config,
      'AI_SERVICE_URL',
      'AI_SERVICE_ALLOWED_HOSTS',
      'http://ai-service:8000',
    );
    this.timeoutMs = configuredTimeout(config, 'AI_REQUEST_TIMEOUT_MS');
    this.internalApiKey = config.get<string>('AI_INTERNAL_API_KEY');
  }

  isConfigured(): boolean {
    return this.configuredApiKey() !== undefined;
  }

  async recommendJobs(
    cvId: string,
    query: JobRecommendationQueryDto,
  ): Promise<AiRecommendationResult> {
    const internalApiKey = this.configuredApiKey();
    if (!isUuidV4(cvId) || !internalApiKey) {
      throw new AiRecommendationUnavailableError();
    }

    const request: Record<string, unknown> = {
      cv_id: cvId.toLowerCase(),
      limit: query.limit,
    };
    if (query.cursor !== undefined) request.cursor = query.cursor;
    if (query.location !== undefined) request.location = query.location;
    if (query.salaryMin !== undefined) request.salary_min = query.salaryMin;
    if (query.jobType !== undefined) request.job_type = query.jobType;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/recommend/jobs`, {
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
      throw new AiRecommendationUnavailableError();
    }
    if (response.status === 409) {
      let body: unknown;
      try {
        body = await readBoundedJson(response);
      } catch {
        throw new AiRecommendationInvalidResponseError();
      }
      if (
        !isPlainObject(body) ||
        !hasExactKeys(body, CURSOR_STALE_KEYS) ||
        body.code !== CURSOR_STALE_CODE ||
        typeof body.message !== 'string' ||
        body.message.length < 1 ||
        body.message.length > 256 ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(body.message) ||
        body.details !== null
      ) {
        throw new AiRecommendationInvalidResponseError();
      }
      if (query.cursor !== undefined) {
        throw new AiRecommendationCursorStaleError();
      }
      throw new AiRecommendationInvalidResponseError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiRecommendationUnavailableError();
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new AiRecommendationInvalidResponseError();
    }
    return this.validateResponse(body, cvId, query.limit);
  }

  private configuredApiKey(): string | undefined {
    const value = this.internalApiKey;
    const byteLength = value ? Buffer.byteLength(value, 'utf8') : 0;
    return value &&
      byteLength >= 32 &&
      byteLength <= 512 &&
      /^[\x21-\x7e]+$/.test(value)
      ? value
      : undefined;
  }

  private validateResponse(
    body: unknown,
    cvId: string,
    limit: number,
  ): AiRecommendationResult {
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, ENVELOPE_KEYS) ||
      body.meta !== null ||
      !isPlainObject(body.data) ||
      !hasExactKeys(body.data, DATA_KEYS) ||
      !isUuidV4(body.data.cv_id) ||
      body.data.cv_id.toLowerCase() !== cvId.toLowerCase() ||
      !Array.isArray(body.data.items) ||
      body.data.items.length > limit
    ) {
      throw new AiRecommendationInvalidResponseError();
    }

    const reason = body.data.reason;
    if (
      reason !== null &&
      !Object.values(AiRecommendationReason).includes(
        reason as AiRecommendationReason,
      )
    ) {
      throw new AiRecommendationInvalidResponseError();
    }
    const nextCursor = body.data.next_cursor;
    if (
      nextCursor !== null &&
      (typeof nextCursor !== 'string' ||
        Buffer.byteLength(nextCursor, 'utf8') < 1 ||
        Buffer.byteLength(nextCursor, 'utf8') > 1_024)
    ) {
      throw new AiRecommendationInvalidResponseError();
    }

    const ids = new Set<string>();
    let previousScore = Number.POSITIVE_INFINITY;
    const items = body.data.items.map((value): AiRecommendationItem => {
      if (
        !isPlainObject(value) ||
        !hasExactKeys(value, ITEM_KEYS) ||
        !isUuidV4(value.job_id) ||
        typeof value.score !== 'number' ||
        !Number.isFinite(value.score) ||
        value.score < 0 ||
        value.score > 1 ||
        value.score > previousScore
      ) {
        throw new AiRecommendationInvalidResponseError();
      }
      const jobId = value.job_id.toLowerCase();
      if (ids.has(jobId)) {
        throw new AiRecommendationInvalidResponseError();
      }
      ids.add(jobId);
      previousScore = value.score;
      return { jobId, score: value.score };
    });

    if (
      (items.length > 0) === (reason !== null) ||
      (items.length === 0 && nextCursor !== null)
    ) {
      throw new AiRecommendationInvalidResponseError();
    }
    return {
      items,
      nextCursor: nextCursor as string | null,
      reason: reason as AiRecommendationReason | null,
    };
  }
}
