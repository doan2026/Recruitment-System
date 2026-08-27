import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ApiException } from '../http/api-exception';
import { InternalCaller } from './auth-user.interface';

const APPLICATION_SERVICE = 'application-service';
const KEY_ENVIRONMENT = 'INTERNAL_API_KEY_APPLICATION';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

@Injectable()
export class InternalAuthService {
  constructor(private readonly config: ConfigService) {}

  assertConfiguration(): void {
    this.getConfiguredKey();
  }

  authenticate(
    keyHeader: string | string[] | undefined,
    serviceHeader: string | string[] | undefined,
  ): InternalCaller {
    const expectedKey = this.getConfiguredKey();
    const providedKey =
      typeof keyHeader === 'string' ? keyHeader.trim() : '';
    const providedService =
      typeof serviceHeader === 'string' ? serviceHeader.trim() : '';

    if (
      providedService !== APPLICATION_SERVICE ||
      !this.matchesKey(providedKey, expectedKey)
    ) {
      throw new ApiException(
        'INTERNAL_AUTH_INVALID',
        'Internal service authentication failed',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return { service: APPLICATION_SERVICE };
  }

  private getConfiguredKey(): string {
    const rawValue = this.config.get<unknown>(KEY_ENVIRONMENT);
    if (typeof rawValue !== 'string') {
      throw this.configurationError();
    }
    const key = rawValue.trim();
    if (
      CONTROL_CHARACTER_PATTERN.test(rawValue) ||
      Buffer.byteLength(key, 'utf8') < 32 ||
      key.toLowerCase().includes('replace-with') ||
      CONTROL_CHARACTER_PATTERN.test(key)
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

  private configurationError(): ApiException {
    return new ApiException(
      'INTERNAL_AUTH_CONFIGURATION_ERROR',
      `${KEY_ENVIRONMENT} must be a non-placeholder key of at least 32 bytes`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
