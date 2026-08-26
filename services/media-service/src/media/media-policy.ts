import {
  FileOwnerType,
  MediaType,
  StorageDeliveryType,
  StorageResourceType,
} from '@prisma/client';
import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../common/http/api-exception';
import {
  InternalServiceName,
} from '../common/auth/auth-context';
import { SystemRole } from '../common/auth/system-role.enum';

export interface MediaPolicy {
  mediaType: MediaType;
  folder: string;
  presetEnvironment: string;
  formats: readonly string[];
  resourceType: StorageResourceType;
  deliveryType: StorageDeliveryType;
  maxBytes: number;
  ownerTypes: readonly FileOwnerType[];
  maxActivePerOwner?: number;
}

const MIB = 1024 * 1024;

export const MEDIA_POLICIES: Record<MediaType, MediaPolicy> = {
  [MediaType.CV]: {
    mediaType: MediaType.CV,
    folder: 'recruitment/cv',
    presetEnvironment: 'CLOUDINARY_UPLOAD_PRESET_CV',
    formats: ['pdf'],
    resourceType: StorageResourceType.RAW,
    deliveryType: StorageDeliveryType.AUTHENTICATED,
    maxBytes: 5 * MIB,
    ownerTypes: [FileOwnerType.USER],
  },
  [MediaType.AVATAR]: {
    mediaType: MediaType.AVATAR,
    folder: 'recruitment/avatar',
    presetEnvironment: 'CLOUDINARY_UPLOAD_PRESET_AVATAR',
    formats: ['jpg', 'png', 'webp'],
    resourceType: StorageResourceType.IMAGE,
    deliveryType: StorageDeliveryType.UPLOAD,
    maxBytes: 2 * MIB,
    ownerTypes: [FileOwnerType.USER],
  },
  [MediaType.COMPANY_LOGO]: {
    mediaType: MediaType.COMPANY_LOGO,
    folder: 'recruitment/company-logo',
    presetEnvironment: 'CLOUDINARY_UPLOAD_PRESET_COMPANY_LOGO',
    formats: ['jpg', 'png', 'webp'],
    resourceType: StorageResourceType.IMAGE,
    deliveryType: StorageDeliveryType.UPLOAD,
    maxBytes: 2 * MIB,
    ownerTypes: [FileOwnerType.COMPANY],
    maxActivePerOwner: 1,
  },
  [MediaType.COMPANY_IMAGE]: {
    mediaType: MediaType.COMPANY_IMAGE,
    folder: 'recruitment/company-image',
    presetEnvironment: 'CLOUDINARY_UPLOAD_PRESET_COMPANY_IMAGE',
    formats: ['jpg', 'png', 'webp'],
    resourceType: StorageResourceType.IMAGE,
    deliveryType: StorageDeliveryType.UPLOAD,
    maxBytes: 5 * MIB,
    ownerTypes: [FileOwnerType.COMPANY],
    maxActivePerOwner: 10,
  },
  [MediaType.COMPANY_VIDEO]: {
    mediaType: MediaType.COMPANY_VIDEO,
    folder: 'recruitment/company-video',
    presetEnvironment: 'CLOUDINARY_UPLOAD_PRESET_COMPANY_VIDEO',
    formats: ['mp4'],
    resourceType: StorageResourceType.VIDEO,
    deliveryType: StorageDeliveryType.UPLOAD,
    maxBytes: 50 * MIB,
    ownerTypes: [FileOwnerType.COMPANY],
    maxActivePerOwner: 1,
  },
  [MediaType.CHAT_ATTACHMENT]: {
    mediaType: MediaType.CHAT_ATTACHMENT,
    folder: 'recruitment/chat-attachment',
    presetEnvironment: 'CLOUDINARY_UPLOAD_PRESET_CHAT_ATTACHMENT',
    formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'webp'],
    resourceType: StorageResourceType.RAW,
    deliveryType: StorageDeliveryType.AUTHENTICATED,
    maxBytes: 10 * MIB,
    ownerTypes: [FileOwnerType.USER],
  },
};

const PUBLIC_ALLOWED_TYPES: Record<SystemRole, readonly MediaType[]> = {
  [SystemRole.CANDIDATE]: [
    MediaType.CV,
    MediaType.AVATAR,
    MediaType.CHAT_ATTACHMENT,
  ],
  [SystemRole.RECRUITER]: [
    MediaType.AVATAR,
    MediaType.CHAT_ATTACHMENT,
  ],
  [SystemRole.ADMIN]: [MediaType.AVATAR],
};

const PRODUCER_ALLOWED_TYPES: Partial<
  Record<InternalServiceName, readonly MediaType[]>
> = {
  'profile-service': [MediaType.CV, MediaType.AVATAR],
  'company-service': [
    MediaType.COMPANY_LOGO,
    MediaType.COMPANY_IMAGE,
    MediaType.COMPANY_VIDEO,
  ],
  'chat-service': [MediaType.CHAT_ATTACHMENT],
};

const CONSUMER_ALLOWED_TYPES: Record<
  InternalServiceName,
  readonly MediaType[]
> = {
  'profile-service': [MediaType.CV, MediaType.AVATAR],
  'company-service': [
    MediaType.COMPANY_LOGO,
    MediaType.COMPANY_IMAGE,
    MediaType.COMPANY_VIDEO,
  ],
  'application-service': [MediaType.CV],
  'chat-service': [MediaType.CHAT_ATTACHMENT],
  'interview-service': [MediaType.CV],
  'ai-service': [MediaType.CV],
};

export const getMediaPolicy = (
  mediaType: MediaType,
): MediaPolicy => MEDIA_POLICIES[mediaType];

export const assertPublicUploadAllowed = (
  role: SystemRole,
  mediaType: MediaType,
): void => {
  if (!PUBLIC_ALLOWED_TYPES[role]?.includes(mediaType)) {
    throw new ApiException(
      'FILE_TYPE_FORBIDDEN',
      'This role cannot create the requested upload type',
      HttpStatus.FORBIDDEN,
    );
  }
};

export const assertInternalProducerAllowed = (
  service: InternalServiceName,
  mediaType: MediaType,
  ownerType: FileOwnerType,
): void => {
  const policy = getMediaPolicy(mediaType);
  if (
    !PRODUCER_ALLOWED_TYPES[service]?.includes(mediaType) ||
    !policy.ownerTypes.includes(ownerType)
  ) {
    throw new ApiException(
      'FILE_SCOPE_FORBIDDEN',
      'The internal service cannot create this file scope',
      HttpStatus.FORBIDDEN,
    );
  }
};

export const assertInternalConsumerAllowed = (
  service: InternalServiceName,
  mediaType: MediaType,
): void => {
  if (!CONSUMER_ALLOWED_TYPES[service].includes(mediaType)) {
    throw new ApiException(
      'FILE_SCOPE_FORBIDDEN',
      'The internal service cannot access this file type',
      HttpStatus.FORBIDDEN,
    );
  }
};

export interface ValidatedFilename {
  originalFilename: string;
  format: string;
}

export const validateOriginalFilename = (
  originalFilename: string,
  policy: MediaPolicy,
): ValidatedFilename => {
  const normalized = originalFilename.normalize('NFC').trim();
  if (
    !normalized ||
    normalized.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/u.test(normalized) ||
    /\p{Cf}/u.test(normalized)
  ) {
    throw new ApiException(
      'FILE_NAME_INVALID',
      'The original filename is invalid',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  const separator = normalized.lastIndexOf('.');
  const rawFormat =
    separator >= 0 ? normalized.slice(separator + 1).toLowerCase() : '';
  const format = rawFormat === 'jpeg' ? 'jpg' : rawFormat;
  if (!policy.formats.includes(format)) {
    throw new ApiException(
      'FILE_FORMAT_NOT_ALLOWED',
      'The file extension is not allowed for this upload type',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { allowedFormats: policy.formats },
    );
  }

  return { originalFilename: normalized, format };
};

export const mimeForFormat = (format: string): string => {
  const values: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
  };
  const value = values[format];
  if (!value) {
    throw new Error('Unsupported canonical media format');
  }
  return value;
};

const startsWith = (
  sample: Buffer,
  signature: readonly number[],
): boolean =>
  signature.every((value, index) => sample[index] === value);

export const matchesMagicBytes = (
  format: string,
  sample: Buffer,
): boolean => {
  if (format === 'pdf') {
    return sample.subarray(0, 5).equals(Buffer.from('%PDF-'));
  }
  if (format === 'doc') {
    return startsWith(sample, [
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
  }
  if (format === 'docx') {
    return startsWith(sample, [0x50, 0x4b, 0x03, 0x04]);
  }
  if (format === 'jpg') {
    return startsWith(sample, [0xff, 0xd8, 0xff]);
  }
  if (format === 'png') {
    return startsWith(sample, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  }
  if (format === 'webp') {
    return (
      sample.subarray(0, 4).toString('ascii') === 'RIFF' &&
      sample.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (format === 'mp4') {
    return sample.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  return false;
};
