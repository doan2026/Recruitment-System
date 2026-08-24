import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from './common';

export interface RecruiterCompany {
  companyId: string;
  name: string;
  verifiedStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  memberRole: 'OWNER' | 'MEMBER';
}

@Injectable()
export class CompanyClientService {
  constructor(private readonly config: ConfigService) {}

  async getRecruiterCompany(
    userId: string,
    authorization: string,
  ): Promise<RecruiterCompany> {
    const baseUrl = this.config.get<string>('COMPANY_SERVICE_URL');
    if (!baseUrl) {
      throw new Error('COMPANY_SERVICE_URL is required');
    }

    let response: Response;
    try {
      response = await fetch(
        baseUrl.replace(/\/$/, '') + '/by-user/' + userId,
        {
          headers: { authorization },
          signal: AbortSignal.timeout(3000),
        },
      );
    } catch {
      throw new ApiException(
        'COMPANY_SERVICE_UNAVAILABLE',
        'Company Service is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: RecruiterCompany;
      code?: string;
      message?: string;
    };
    if (!response.ok || !body.data) {
      throw new ApiException(
        body.code ?? 'COMPANY_LOOKUP_FAILED',
        body.message ?? 'Cannot resolve recruiter company',
        response.status >= 400 && response.status < 600
          ? response.status as HttpStatus
          : HttpStatus.BAD_GATEWAY,
      );
    }
    return body.data;
  }
}
