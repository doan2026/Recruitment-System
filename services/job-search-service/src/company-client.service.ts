import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from './common';
import {
  configuredServiceUrl,
  configuredTimeout,
  hasExactKeys,
  isPlainObject,
  isUuidV4,
  readBoundedJson,
} from './recommendation-http';

const COMPANY_ENVELOPE_KEYS = ['data', 'meta'] as const;
const RECRUITER_COMPANY_KEYS = [
  'companyId',
  'name',
  'verifiedStatus',
  'memberRole',
] as const;

export interface RecruiterCompany {
  companyId: string;
  name: string;
  verifiedStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  memberRole: 'OWNER' | 'MEMBER';
}

const COMPANY_NAME_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export class CompanyIndexingLookupError extends Error {}

function isCanonicalCompanyName(name: unknown): name is string {
  return typeof name === 'string' &&
    [...name].length >= 2 &&
    [...name].length <= 160 &&
    !COMPANY_NAME_CONTROL_CHARACTERS.test(name) &&
    name === name.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

@Injectable()
export class CompanyClientService {
  constructor(private readonly config: ConfigService) {}

  isRecommendationConfigured(): boolean {
    try {
      this.recommendationConfig();
      return true;
    } catch {
      return false;
    }
  }

  async getRecruiterCompany(
    userId: string,
    authorization: string,
  ): Promise<RecruiterCompany> {
    return this.getRecruiterCompanyForRecommendation(userId, authorization);
  }

  async getRecruiterCompanyForRecommendation(
    userId: string,
    authorization: string,
  ): Promise<RecruiterCompany> {
    if (
      !isUuidV4(userId) ||
      userId !== userId.toLowerCase() ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i
        .test(authorization) ||
      authorization.length > 8_192 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(authorization)
    ) {
      throw new ApiException(
        'UNAUTHORIZED',
        'A valid recruiter access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    let baseUrl: string;
    let timeoutMs: number;
    try {
      ({ baseUrl, timeoutMs } = this.recommendationConfig());
    } catch {
      throw this.recommendationLookupUnavailable();
    }
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/by-user/${userId}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw this.recommendationLookupUnavailable();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === HttpStatus.NOT_FOUND) {
        throw new ApiException(
          'COMPANY_NOT_FOUND',
          'No company is associated with this recruiter',
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        response.status === HttpStatus.UNAUTHORIZED ||
        response.status === HttpStatus.FORBIDDEN
      ) {
        throw new ApiException(
          'COMPANY_ACCESS_DENIED',
          'Recruiter company authorization failed',
          response.status,
        );
      }
      throw this.recommendationLookupUnavailable();
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw this.recommendationLookupUnavailable();
    }
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, COMPANY_ENVELOPE_KEYS) ||
      body.meta !== null ||
      !isPlainObject(body.data) ||
      !hasExactKeys(body.data, RECRUITER_COMPANY_KEYS) ||
      !isUuidV4(body.data.companyId) ||
      body.data.companyId !== body.data.companyId.toLowerCase() ||
      !isCanonicalCompanyName(body.data.name) ||
      !['PENDING', 'VERIFIED', 'REJECTED'].includes(
        body.data.verifiedStatus as string,
      ) ||
      !['OWNER', 'MEMBER'].includes(body.data.memberRole as string)
    ) {
      throw this.recommendationLookupUnavailable();
    }
    return {
      companyId: body.data.companyId,
      name: body.data.name,
      verifiedStatus: body.data.verifiedStatus as RecruiterCompany['verifiedStatus'],
      memberRole: body.data.memberRole as RecruiterCompany['memberRole'],
    };
  }

  /**
   * Company name for the search index. Uses Company's internal lookup instead
   * of the public profile: a PUBLISHED job stays searchable while its company
   * is back in PENDING review after a legal-field edit, and the public
   * endpoint hides such companies (404), which used to dead-letter the job.
   */
  async getCompanyNameForIndexing(companyId: string): Promise<string> {
    const apiKey = this.indexingApiKey();
    if (!apiKey) {
      throw new CompanyIndexingLookupError('COMPANY_INTERNAL_API_KEY is not configured');
    }
    const { baseUrl, timeoutMs } = this.recommendationConfig();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/internal/${companyId}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-internal-api-key': apiKey,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CompanyIndexingLookupError('Company Service is unavailable while indexing');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new CompanyIndexingLookupError(
        `Cannot resolve company ${companyId} for indexing (HTTP ${response.status})`,
      );
    }
    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new CompanyIndexingLookupError('Company Service returned an unreadable indexing response');
    }
    if (
      !isPlainObject(body) ||
      !isPlainObject(body.data) ||
      body.data.id !== companyId ||
      !isCanonicalCompanyName(body.data.name)
    ) {
      throw new CompanyIndexingLookupError('Company Service returned an invalid indexing response');
    }
    return body.data.name;
  }

  private indexingApiKey(): string | undefined {
    const value = this.config.get<string>('COMPANY_INTERNAL_API_KEY');
    const byteLength = value ? Buffer.byteLength(value, 'utf8') : 0;
    return value &&
      !value.toLowerCase().includes('replace-with') &&
      byteLength >= 32 &&
      byteLength <= 512 &&
      /^[\x21-\x7e]+$/.test(value)
      ? value
      : undefined;
  }

  private recommendationLookupUnavailable(): ApiException {
    return new ApiException(
      'COMPANY_SERVICE_UNAVAILABLE',
      'Company Service is unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private recommendationConfig(): { baseUrl: string; timeoutMs: number } {
    return {
      baseUrl: configuredServiceUrl(
        this.config,
        'COMPANY_SERVICE_URL',
        'COMPANY_SERVICE_ALLOWED_HOSTS',
        'http://company-service:3000',
      ),
      timeoutMs: configuredTimeout(
        this.config,
        'COMPANY_REQUEST_TIMEOUT_MS',
      ),
    };
  }
}
