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

interface PublicCompany {
  id: string;
  name: string;
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
      typeof body.data.name !== 'string' ||
      [...body.data.name].length < 2 ||
      [...body.data.name].length > 160 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(body.data.name) ||
      body.data.name !== body.data.name.normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ') ||
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

  async getPublicCompanyName(companyId: string): Promise<string> {
    const baseUrl = this.config.get<string>('COMPANY_SERVICE_URL');
    if (!baseUrl) throw new Error('COMPANY_SERVICE_URL is required');
    let response: Response;
    try {
      response = await fetch(
        baseUrl.replace(/\/$/, '') + '/' + companyId,
        { signal: AbortSignal.timeout(3000) },
      );
    } catch {
      throw new Error('Company Service is unavailable while indexing');
    }
    const body = (await response.json().catch(() => ({}))) as {
      data?: PublicCompany;
    };
    if (!response.ok || !body.data?.name) {
      throw new Error(`Cannot resolve public company ${companyId}`);
    }
    return body.data.name;
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
