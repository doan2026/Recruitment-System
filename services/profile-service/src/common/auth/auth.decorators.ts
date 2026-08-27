import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  AuthUser,
  InternalCaller,
} from './auth-user.interface';
import { SystemRole } from './system-role.enum';

export const PUBLIC_ROUTE_KEY = 'profile:public-route';
export const INTERNAL_ONLY_KEY = 'profile:internal-only';
export const INTERNAL_CANDIDATE_JWT_KEY =
  'profile:internal-candidate-jwt';
export const SYSTEM_ROLES_KEY = 'profile:system-roles';

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_KEY, true);

export const InternalOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(INTERNAL_ONLY_KEY, true);

export const InternalCandidateJwt = (): MethodDecorator =>
  SetMetadata(INTERNAL_CANDIDATE_JWT_KEY, true);

export const Roles = (
  ...roles: SystemRole[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(SYSTEM_ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error('Authenticated user is unavailable');
    }
    return request.user;
  },
);

export const CurrentInternalCaller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): InternalCaller => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (!request.internalCaller) {
      throw new Error('Authenticated internal caller is unavailable');
    }
    return request.internalCaller;
  },
);
