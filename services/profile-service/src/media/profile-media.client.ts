export enum ProfileMediaType {
  AVATAR = 'AVATAR',
  CV = 'CV',
}

export const PROFILE_MEDIA_TYPES = [
  ProfileMediaType.AVATAR,
  ProfileMediaType.CV,
] as const;

interface VerifiedUserFileBase {
  readonly id: string;
  readonly ownerType: 'USER';
  readonly ownerId: string;
  readonly status: 'ACTIVE';
  readonly originalFilename: string;
  readonly mimeType: string | null;
  readonly format: string | null;
  readonly bytes: number | null;
  readonly aggregateVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VerifiedUserAvatar extends VerifiedUserFileBase {
  readonly type: ProfileMediaType.AVATAR;
  readonly url: string;
  readonly privateDelivery: false;
}

export interface VerifiedUserCv extends VerifiedUserFileBase {
  readonly type: ProfileMediaType.CV;
  readonly url: null;
  readonly privateDelivery: true;
}

export type VerifiedUserFile = VerifiedUserAvatar | VerifiedUserCv;

export interface UserFileReference {
  readonly id: string;
  readonly fileId: string;
  readonly callerService: 'profile-service';
  readonly referenceType: string;
  readonly referenceId: string;
  readonly createdAt: string;
}

export interface UserFileDownloadUrl {
  readonly url: string;
  readonly expiresAt: string;
}

export type VerifiedMediaFile = VerifiedUserFile;
export type BoundMediaReference = UserFileReference;
export type MediaDownloadUrl = UserFileDownloadUrl;

export abstract class ProfileMediaClient {
  abstract verifyUserFile<T extends ProfileMediaType>(
    fileId: string,
    userId: string,
    type: T,
  ): Promise<Extract<VerifiedUserFile, { type: T }>>;

  abstract bindUserFile(
    fileId: string,
    userId: string,
    type: ProfileMediaType,
    referenceType: string,
    referenceId: string,
  ): Promise<UserFileReference>;

  abstract releaseReference(referenceId: string): Promise<void>;

  abstract createUserDownloadUrl(
    fileId: string,
    userId: string,
    type: ProfileMediaType,
  ): Promise<UserFileDownloadUrl>;
}
