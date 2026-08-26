import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { AuthenticatedRequest, AuthUser } from './auth-user.interface';
import { SystemRole } from './system-role.enum';

export const PUBLIC_ROUTE_KEY = 'profile:public-route';
export const SYSTEM_ROLES_KEY = 'profile:system-roles';

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_KEY, true);

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
