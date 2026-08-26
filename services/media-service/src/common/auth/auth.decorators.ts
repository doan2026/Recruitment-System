import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import {
  AuthUser,
  InternalCaller,
  RequestWithAuth,
} from './auth-context';
import { SystemRole } from './system-role.enum';

export const IS_PUBLIC_KEY = 'isPublic';
export const INTERNAL_ONLY_KEY = 'internalOnly';
export const ROLES_KEY = 'roles';

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

export const InternalOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(INTERNAL_ONLY_KEY, true);

export const Roles = (
  ...roles: SystemRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!request.authUser) {
      throw new Error('Authenticated user is unavailable');
    }
    return request.authUser;
  },
);

export const CurrentInternalCaller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): InternalCaller => {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!request.internalCaller) {
      throw new Error('Internal caller is unavailable');
    }
    return request.internalCaller;
  },
);
