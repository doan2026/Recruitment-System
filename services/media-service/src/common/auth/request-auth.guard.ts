import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../http/api-exception';
import {
  INTERNAL_ONLY_KEY,
  IS_PUBLIC_KEY,
} from './auth.decorators';
import { RequestWithAuth } from './auth-context';
import { InternalAuthService } from './internal-auth.service';
import { JwtVerifierService } from './jwt-verifier.service';

@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtVerifier: JwtVerifierService,
    private readonly internalAuth: InternalAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<RequestWithAuth>();
    const internalOnly = this.reflector.getAllAndOverride<boolean>(
      INTERNAL_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (internalOnly) {
      request.internalCaller = this.internalAuth.authenticate(
        request.headers['x-internal-api-key'],
        request.headers['x-internal-service'],
      );
      return true;
    }

    const authorization = request.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ') ||
      authorization.length <= 7
    ) {
      throw new ApiException(
        'AUTHENTICATION_REQUIRED',
        'A valid bearer access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      request.authUser = await this.jwtVerifier.verify(
        authorization.slice(7),
      );
      return true;
    } catch (error) {
      if (
        error instanceof ApiException &&
        error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE
      ) {
        throw error;
      }
      throw new ApiException(
        'ACCESS_TOKEN_INVALID',
        'The access token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
