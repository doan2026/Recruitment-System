export enum SystemRole {
  ADMIN = 'ADMIN',
  CANDIDATE = 'CANDIDATE',
  RECRUITER = 'RECRUITER',
}

export interface AuthUser {
  id: string;
  systemRole: SystemRole;
}
