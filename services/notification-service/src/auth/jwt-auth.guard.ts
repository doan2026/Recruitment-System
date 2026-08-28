import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/api-exception';
import { AuthenticatedRequest } from './auth-user.interface';
import { JwtVerifierService } from './jwt-verifier.service';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const values = authorizationHeaders(request.rawHeaders);
    if (values.length !== 1 || values[0].includes(',')) {
      throw new UnauthorizedException('Exactly one Bearer token is required');
    }
    const match = values[0].match(/^Bearer ([A-Za-z0-9._~-]+)$/);
    if (!match) {
      throw new UnauthorizedException('Bearer access token is required');
    }
    try {
      request.user = await this.verifier.verify(match[1]);
      return true;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }
}

const authorizationHeaders = (rawHeaders: string[]): string[] => {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'authorization') {
      values.push(rawHeaders[index + 1] ?? '');
    }
  }
  return values;
};
