import { SetMetadata } from '@nestjs/common';
import { SystemRole } from './system-role.enum';

export const SYSTEM_ROLES_KEY = 'systemRoles';
export const Roles = (...roles: SystemRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SYSTEM_ROLES_KEY, roles);
