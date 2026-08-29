import {
  CallHandler,
  CanActivate,
  Catch,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { Observable, map } from 'rxjs';
import { type AuthUser, SystemRole } from './auth.types';
import {
  AuthConfigurationError,
  AuthKeyUnavailableError,
  InvalidAccessTokenError,
  JwtVerifierService,
} from './jwt-verifier.service';

export { type AuthUser, SystemRole } from './auth.types';

export class ApiException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }
}

const PUBLIC_KEY = 'isPublic';
const INTERNAL_KEY = 'isInternal';
const ROLES_KEY = 'roles';
const MAX_ACCESS_TOKEN_BYTES = 8 * 1024;
const MAX_AUTHORIZATION_HEADER_BYTES =
  MAX_ACCESS_TOKEN_BYTES + Buffer.byteLength('Bearer ', 'ascii');
const COMPACT_BEARER_PATTERN =
  /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
  user?: AuthUser;
}

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Internal = () => SetMetadata(INTERNAL_KEY, true);
export const Roles = (...roles: SystemRole[]) =>
  SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest().user,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const internal = this.reflector.getAllAndOverride<boolean>(INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (internal) {
      const expected = this.config.get<string>('INTERNAL_API_KEY');
      if (!expected) throw new Error('INTERNAL_API_KEY is required');
      const header = context.switchToHttp().getRequest()
        .headers['x-internal-api-key'];
      const provided = Array.isArray(header) ? header[0] : header;
      if (
        typeof provided !== 'string' ||
        !this.secureEquals(provided, expected)
      ) {
        throw new ApiException(
          'INVALID_INTERNAL_API_KEY',
          'A valid internal API key is required',
          HttpStatus.UNAUTHORIZED,
        );
      }
      return true;
    }
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const token = this.readBearerToken(request.rawHeaders);

    try {
      request.user = await this.verifier.verify(token);
      return true;
    } catch (error) {
      if (error instanceof AuthKeyUnavailableError) {
        throw new ApiException(
          'AUTH_KEY_UNAVAILABLE',
          'Access token verification key is temporarily unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (error instanceof AuthConfigurationError) {
        throw new ApiException(
          'AUTH_CONFIGURATION_ERROR',
          'Access token verification is not configured',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (error instanceof InvalidAccessTokenError) {
        throw this.invalidAccessToken();
      }
      throw new InternalServerErrorException();
    }
  }

  private readBearerToken(rawHeaders: string[] | undefined): string {
    if (!Array.isArray(rawHeaders)) {
      throw this.missingAccessToken();
    }

    const authorizationValues: string[] = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === 'authorization') {
        authorizationValues.push(rawHeaders[index + 1] ?? '');
      }
    }

    if (authorizationValues.length !== 1) {
      throw this.missingAccessToken();
    }
    const authorization = authorizationValues[0];
    if (
      Buffer.byteLength(authorization, 'utf8') >
      MAX_AUTHORIZATION_HEADER_BYTES
    ) {
      throw this.missingAccessToken();
    }
    const match = COMPACT_BEARER_PATTERN.exec(authorization);
    if (
      !match ||
      Buffer.byteLength(match[1], 'ascii') > MAX_ACCESS_TOKEN_BYTES
    ) {
      throw this.missingAccessToken();
    }
    return match[1];
  }

  private missingAccessToken(): ApiException {
    return new ApiException(
      'UNAUTHORIZED',
      'Bearer access token is required',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidAccessToken(): ApiException {
    return new ApiException(
      'UNAUTHORIZED',
      'Access token is invalid or expired',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private secureEquals(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    return (
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<SystemRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser;
    if (!roles.includes(user.systemRole)) {
      throw new ApiException(
        'FORBIDDEN',
        'This role cannot access the resource',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

@Injectable()
export class ApiResponseInterceptor
  implements NestInterceptor<unknown, { data: unknown; meta: null }>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<{ data: unknown; meta: null }> {
    return next.handle().pipe(map((data) => ({ data, meta: null })));
  }
}

@Catch()
export class ApiExceptionFilter {
  catch(error: unknown, host: import('@nestjs/common').ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    if (error instanceof ApiException) {
      response.status(error.getStatus()).json({
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return;
    }
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json({
        code: 'REQUEST_ERROR',
        message: error.message,
      });
      return;
    }
    response.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}
