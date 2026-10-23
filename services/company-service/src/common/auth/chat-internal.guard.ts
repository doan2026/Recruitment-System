import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ApiException } from '../errors/api-exception';

@Injectable()
export class ChatInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const key = this.config.get<string>('INTERNAL_API_KEY_CHAT');
    if (!key || !/^[\x21-\x7e]{32,512}$/.test(key) || key.toLowerCase().includes('replace-with') || key === this.config.get<string>('INTERNAL_API_KEY_JOB_SEARCH')) {
      throw new ApiException('INTERNAL_API_KEY_NOT_CONFIGURED', 'Internal chat access is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const headers = context.switchToHttp().getRequest().headers;
    const provided = headers['x-internal-api-key'];
    if (headers['x-internal-service'] !== 'chat-service' || typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(key) || !timingSafeEqual(Buffer.from(provided), Buffer.from(key))) {
      throw new ApiException('INVALID_INTERNAL_API_KEY', 'A valid internal chat identity is required', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
