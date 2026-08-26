import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../http/api-exception';
import { ROLES_KEY } from './auth.decorators';
import { RequestWithAuth } from './auth-context';
import { SystemRole } from './system-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<SystemRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) {
      return true;
    }

    const user = context
      .switchToHttp()
      .getRequest<RequestWithAuth>().authUser;
    if (!user || !roles.includes(user.systemRole)) {
      throw new ApiException(
        'ROLE_FORBIDDEN',
        'The authenticated role cannot perform this operation',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
