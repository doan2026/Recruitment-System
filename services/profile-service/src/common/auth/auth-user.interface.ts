import { Request } from 'express';
import { SystemRole } from './system-role.enum';

export interface AuthUser {
  id: string;
  systemRole: SystemRole;
  claims: Record<string, unknown>;
}

export type InternalService =
  | 'application-service'
  | 'job-search-service';

export interface InternalCaller {
  service: InternalService;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  internalCaller?: InternalCaller;
}
