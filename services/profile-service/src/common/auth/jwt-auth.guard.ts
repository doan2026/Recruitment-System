import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../http/api-exception';
import { AuthenticatedRequest } from './auth-user.interface';
import {
  INTERNAL_CANDIDATE_JWT_KEY,
  INTERNAL_ONLY_KEY,
  PUBLIC_ROUTE_KEY,
} from './auth.decorators';
import { InternalAuthService } from './internal-auth.service';
import { JwtVerifierService } from './jwt-verifier.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
    private readonly internalAuth: InternalAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const isInternal = this.reflector.getAllAndOverride<boolean>(
      INTERNAL_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Internal-only must win over every other metadata combination so an
    // accidental @Public decorator can never expose a service endpoint.
    if (isInternal) {
      request.internalCaller = this.internalAuth.authenticate(
        request.headers['x-internal-api-key'],
        request.headers['x-internal-service'],
      );
      const requiresCandidateJwt =
        this.reflector.getAllAndOverride<boolean>(
          INTERNAL_CANDIDATE_JWT_KEY,
          [context.getHandler(), context.getClass()],
        );
      if (requiresCandidateJwt) {
        request.user = await this.authenticateBearer(request);
      }
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    request.user = await this.authenticateBearer(request);
    return true;
  }

  private async authenticateBearer(
    request: AuthenticatedRequest,
  ): Promise<AuthenticatedRequest['user']> {
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      throw new UnauthorizedException(
        'Bearer access token is required',
      );
    }

    try {
      return await this.verifier.verify(match[1]);
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new UnauthorizedException(
        'Access token is invalid or expired',
      );
    }
  }
}
