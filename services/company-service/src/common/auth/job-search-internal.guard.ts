import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { ApiException } from '../errors/api-exception';

/**
 * Service-to-service access for Job & Search only. The key is scoped to that
 * caller (INTERNAL_API_KEY_JOB_SEARCH) instead of reusing a shared secret, and
 * the gateway strips X-Internal-Api-Key so browsers can never present it.
 */
@Injectable()
export class JobSearchInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_API_KEY_JOB_SEARCH');
    if (
      !expected ||
      expected !== expected.trim() ||
      expected.length < 32 ||
      expected.toLowerCase().includes('replace-with')
    ) {
      throw new ApiException(
        'INTERNAL_API_KEY_NOT_CONFIGURED',
        'Internal access is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const header = context.switchToHttp().getRequest()
      .headers['x-internal-api-key'];
    if (Array.isArray(header) || typeof header !== 'string') {
      throw this.unauthorized();
    }
    const provided = Buffer.from(header, 'utf8');
    const target = Buffer.from(expected, 'utf8');
    if (
      provided.length !== target.length ||
      !timingSafeEqual(provided, target)
    ) {
      throw this.unauthorized();
    }
    return true;
  }

  private unauthorized(): ApiException {
    return new ApiException(
      'INVALID_INTERNAL_API_KEY',
      'A valid internal API key is required',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
