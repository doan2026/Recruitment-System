import {
  CallHandler,
  CanActivate,
  Catch,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { Observable, map } from 'rxjs';

export enum SystemRole {
  ADMIN = 'ADMIN',
  CANDIDATE = 'CANDIDATE',
  RECRUITER = 'RECRUITER',
}

export interface AuthUser {
  id: string;
  systemRole: SystemRole;
}

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
    private readonly jwt: JwtService,
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
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw new ApiException(
        'UNAUTHORIZED',
        'Bearer access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const inline = this.config.get<string>('JWT_PUBLIC_KEY');
    const path = this.config.get<string>('JWT_PUBLIC_KEY_PATH');
    const publicKey = inline?.replace(/\\n/g, '\n') ??
      (path ? readFileSync(path, 'utf8') : undefined);
    if (!publicKey) {
      throw new Error('JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_PATH is required');
    }

    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        { publicKey, algorithms: ['RS256'] },
      );
      const id = payload.sub;
      const systemRole = payload.role;
      if (
        typeof id !== 'string' ||
        !Object.values(SystemRole).includes(systemRole as SystemRole)
      ) {
        throw new Error('Invalid claims');
      }
      request.user = { id, systemRole };
      return true;
    } catch {
      throw new ApiException(
        'UNAUTHORIZED',
        'Access token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
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
