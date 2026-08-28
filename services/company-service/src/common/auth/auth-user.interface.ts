import { Request } from 'express';
import { SystemRole } from './system-role.enum';

export interface AuthUser {
  id: string;
  systemRole: SystemRole;
  claims: Record<string, unknown>;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  accessToken: string;
}
