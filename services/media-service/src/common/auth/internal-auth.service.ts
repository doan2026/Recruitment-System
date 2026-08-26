import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { ApiException } from '../http/api-exception';
import {
  InternalCaller,
  InternalServiceName,
} from './auth-context';

const INTERNAL_SERVICES = new Set<InternalServiceName>([
  'profile-service',
  'company-service',
  'application-service',
  'chat-service',
  'interview-service',
  'ai-service',
]);

const KEY_ENVIRONMENT_BY_SERVICE: Record<InternalServiceName, string> = {
  'profile-service': 'INTERNAL_API_KEY_PROFILE',
  'company-service': 'INTERNAL_API_KEY_COMPANY',
  'application-service': 'INTERNAL_API_KEY_APPLICATION',
  'chat-service': 'INTERNAL_API_KEY_CHAT',
  'interview-service': 'INTERNAL_API_KEY_INTERVIEW',
  'ai-service': 'INTERNAL_API_KEY_AI',
};

@Injectable()
export class InternalAuthService {
  constructor(private readonly config: ConfigService) {}

  assertConfiguration(): void {
    this.getConfiguredKeys();
  }

  authenticate(
    keyHeader: string | string[] | undefined,
    serviceHeader: string | string[] | undefined,
  ): InternalCaller {
    const providedKey =
      typeof keyHeader === 'string' ? keyHeader.trim() : '';
    const service =
      typeof serviceHeader === 'string' ? serviceHeader.trim() : '';

    const recognized = INTERNAL_SERVICES.has(service as InternalServiceName);
    const expectedKey = recognized
      ? this.getConfiguredKeys().get(
          service as InternalServiceName,
        ) ?? ''
      : '';
    if (
      !recognized || !this.matchesKey(providedKey, expectedKey)
    ) {
      throw new ApiException(
        'INTERNAL_AUTH_INVALID',
        'Internal service authentication failed',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return { service: service as InternalServiceName };
  }

  private getConfiguredKeys(): Map<InternalServiceName, string> {
    const configured = new Map<InternalServiceName, string>();
    const owners = new Map<string, InternalServiceName>();
    for (const service of INTERNAL_SERVICES) {
      const key = this.getConfiguredKey(service);
      const existingOwner = owners.get(key);
      if (existingOwner) {
        throw new ApiException(
          'INTERNAL_AUTH_CONFIGURATION_ERROR',
          'Every internal service must use a distinct API key',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      owners.set(key, service);
      configured.set(service, key);
    }
    return configured;
  }

  private getConfiguredKey(service: InternalServiceName): string {
    const environmentName = KEY_ENVIRONMENT_BY_SERVICE[service];
    const key =
      this.config.get<string>(environmentName)?.trim() ?? '';
    if (
      Buffer.byteLength(key, 'utf8') < 32 ||
      key.toLowerCase().includes('replace-with')
    ) {
      throw new ApiException(
        'INTERNAL_AUTH_CONFIGURATION_ERROR',
        environmentName +
          ' must be a non-placeholder key of at least 32 bytes',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
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
}
