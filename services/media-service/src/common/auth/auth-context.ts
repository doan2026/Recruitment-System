import { Request } from 'express';
import { SystemRole } from './system-role.enum';

export interface AuthUser {
  id: string;
  systemRole: SystemRole;
  claims: Record<string, unknown>;
}

export type InternalServiceName =
  | 'profile-service'
  | 'company-service'
  | 'application-service'
  | 'chat-service'
  | 'interview-service'
  | 'ai-service';

export interface InternalCaller {
  service: InternalServiceName;
}

export interface RequestWithAuth extends Request {
  authUser?: AuthUser;
  internalCaller?: InternalCaller;
}
