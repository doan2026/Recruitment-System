import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../errors/api-exception';
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
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw new UnauthorizedException('Bearer access token is required');
    }

    try {
      request.user = await this.verifier.verify(match[1]);
      request.accessToken = match[1];
      return true;
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }
}
