import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ApiException } from '../http/api-exception';
import {
  InternalCaller,
  InternalService,
} from './auth-user.interface';

const APPLICATION_SERVICE: InternalService = 'application-service';
const KEY_ENVIRONMENTS: Readonly<Record<InternalService, string>> = {
  'application-service': 'INTERNAL_API_KEY_APPLICATION',
  'job-search-service': 'INTERNAL_API_KEY_JOB_SEARCH',
  'chat-service': 'INTERNAL_API_KEY_CHAT',
};
const SAFE_KEY_PATTERN = /^[\x21-\x7e]{32,512}$/;

@Injectable()
export class InternalAuthService {
  constructor(private readonly config: ConfigService) {}

  assertConfiguration(): void {
    const applicationKey = this.getConfiguredKey('application-service');
    const jobSearchKey = this.getConfiguredKey('job-search-service');
    if (applicationKey === jobSearchKey) {
      throw this.configurationError();
    }
    const chatSetting = this.config.get<unknown>('INTERNAL_API_KEY_CHAT');
    if (chatSetting !== undefined && chatSetting !== '') {
      const chatKey = this.getConfiguredKey('chat-service');
      if (chatKey === applicationKey || chatKey === jobSearchKey) {
        throw this.configurationError();
      }
    }
  }

  authenticate(
    keyHeader: string | string[] | undefined,
    serviceHeader: string | string[] | undefined,
    allowedServices: readonly InternalService[] = [APPLICATION_SERVICE],
  ): InternalCaller {
    const providedKey =
      typeof keyHeader === 'string' ? keyHeader : '';
    const providedService =
      typeof serviceHeader === 'string' ? serviceHeader : '';
    const service = this.isInternalService(providedService)
      ? providedService
      : null;
    const permitted = service !== null && allowedServices.includes(service);
    const expectedKey = permitted
      ? this.getConfiguredKey(service)
      : this.getConfiguredKey(APPLICATION_SERVICE);

    if (
      !permitted ||
      !this.matchesKey(providedKey, expectedKey)
    ) {
      throw new ApiException(
        'INTERNAL_AUTH_INVALID',
        'Internal service authentication failed',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return { service };
  }

  private getConfiguredKey(service: InternalService): string {
    const environment = KEY_ENVIRONMENTS[service];
    const rawValue = this.config.get<unknown>(environment);
    if (typeof rawValue !== 'string') {
      throw this.configurationError();
    }
    const key = rawValue.trim();
    if (
      rawValue !== key ||
      !SAFE_KEY_PATTERN.test(key) ||
      key.toLowerCase().includes('replace-with')
    ) {
      throw this.configurationError();
    }
    return key;
  }

  private matchesKey(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(providedBuffer, expectedBuffer);
  }

  private isInternalService(value: string): value is InternalService {
    return value === 'application-service' || value === 'job-search-service' || value === 'chat-service';
  }

  private configurationError(): ApiException {
    return new ApiException(
      'INTERNAL_AUTH_CONFIGURATION_ERROR',
      'Profile internal caller keys must be distinct non-placeholder ' +
        'printable ASCII values of 32 to 512 bytes',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
