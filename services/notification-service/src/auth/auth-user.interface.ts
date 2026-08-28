import { Request } from 'express';
import { SystemRole } from './system-role.enum';

export interface AuthUser {
  id: string;
  systemRole: SystemRole;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
