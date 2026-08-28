import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  configuredServiceUrl,
  configuredTimeout,
  hasExactKeys,
  isPlainObject,
  isUuidV4,
  readBoundedJson,
} from './recommendation-http';

const MAX_ACTIVE_CVS = 5;
const ENVELOPE_KEYS = ['data', 'meta'] as const;

export interface RecommendationCv {
  cvId: string;
}

export class ProfileRecommendationUnavailableError extends Error {
  constructor() {
    super('PROFILE_RECOMMENDATION_UNAVAILABLE');
    this.name = 'ProfileRecommendationUnavailableError';
  }
}

interface ValidCv {
  id: string;
  createdAt: number;
  isDefault: boolean;
}

@Injectable()
export class ProfileRecommendationClientService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = configuredServiceUrl(
      config,
      'PROFILE_SERVICE_URL',
      'PROFILE_SERVICE_ALLOWED_HOSTS',
      'http://profile-service:3000',
    );
    this.timeoutMs = configuredTimeout(config, 'PROFILE_REQUEST_TIMEOUT_MS');
  }

  async getPreferredCv(
    candidateId: string,
    authorization: string,
  ): Promise<RecommendationCv | null> {
    if (
      !isUuidV4(candidateId) ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i
        .test(authorization) ||
      authorization.length > 8_192 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(authorization)
    ) {
      throw new ProfileRecommendationUnavailableError();
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/cvs`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProfileRecommendationUnavailableError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProfileRecommendationUnavailableError();
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new ProfileRecommendationUnavailableError();
    }
    const cvs = this.validateEnvelope(body, candidateId);
    if (cvs.length === 0) return null;

    const defaultCvs = cvs.filter(({ isDefault }) => isDefault);
    if (defaultCvs.length > 1) {
      throw new ProfileRecommendationUnavailableError();
    }
    const selected = defaultCvs[0] ?? [...cvs].sort((left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id)
    )[0];
    return { cvId: selected.id };
  }

  private validateEnvelope(body: unknown, candidateId: string): ValidCv[] {
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, ENVELOPE_KEYS) ||
      body.meta !== null ||
      !Array.isArray(body.data) ||
      body.data.length > MAX_ACTIVE_CVS
    ) {
      throw new ProfileRecommendationUnavailableError();
    }

    const ids = new Set<string>();
    return body.data.map((value): ValidCv => {
      if (!isPlainObject(value)) {
        throw new ProfileRecommendationUnavailableError();
      }
      const id = value.id;
      const userId = value.userId;
      const fileId = value.fileId;
      const type = value.type;
      const createdAt = value.createdAt;
      if (
        !isUuidV4(id) ||
        !isUuidV4(userId) ||
        userId.toLowerCase() !== candidateId.toLowerCase() ||
        !isUuidV4(fileId) ||
        !['UPLOAD', 'ONLINE'].includes(type as string) ||
        value.fileUrl !== null ||
        typeof value.isDefault !== 'boolean' ||
        typeof createdAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
          createdAt,
        )
      ) {
        throw new ProfileRecommendationUnavailableError();
      }
      const createdAtMs = Date.parse(createdAt);
      const canonicalId = id.toLowerCase();
      if (
        !Number.isFinite(createdAtMs) ||
        new Date(createdAtMs).toISOString() !== createdAt ||
        ids.has(canonicalId)
      ) {
        throw new ProfileRecommendationUnavailableError();
      }
      ids.add(canonicalId);
      return {
        id: canonicalId,
        createdAt: createdAtMs,
        isDefault: value.isDefault,
      };
    });
  }
}
