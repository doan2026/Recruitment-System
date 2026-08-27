import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cv, CvType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ApiException } from '../common/http/api-exception';
import {
  BoundMediaReference,
  MediaDownloadUrl,
  ProfileMediaClient,
  ProfileMediaType,
  VerifiedMediaFile,
} from '../media/profile-media.client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUploadedCvDto } from './dto/profile-media-input.dto';
import {
  CvDownloadResponseDto,
  UploadedCvResponseDto,
} from './dto/profile-media-response.dto';
import { PROFILE_COMPLETION_RULE_VERSION } from './profile-completion';
import {
  AvatarProjectionMutation,
  ProfileService,
} from './profile.service';

const CV_LIMIT = 5;
const AVATAR_REFERENCE_TYPE = 'PROFILE_AVATAR';
const CV_REFERENCE_TYPE = 'PROFILE_CV';

type Transaction = Prisma.TransactionClient;

interface LockedProfile {
  id: string;
  created: boolean;
}

interface CvProjectionMutation {
  cv: Cv;
  mediaReferenceAccepted: boolean;
}

@Injectable()
export class ProfileMediaService {
  private readonly logger = new Logger(ProfileMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly media: ProfileMediaClient,
  ) {}

  async attachAvatar(
    actorId: string,
    userId: string,
    fileId: string,
  ): Promise<AvatarProjectionMutation['profile']> {
    this.assertOwner(actorId, userId);
    const current = await this.profiles.getExactAvatarProjection(
      actorId,
      userId,
      fileId,
    );
    if (current) {
      return current;
    }
    const verified = await this.media.verifyUserFile(
      fileId,
      userId,
      ProfileMediaType.AVATAR,
    );
    const reference = await this.media.bindUserFile(
      fileId,
      userId,
      ProfileMediaType.AVATAR,
      AVATAR_REFERENCE_TYPE,
      `${userId}:${randomUUID()}`,
    );

    let result: AvatarProjectionMutation;
    try {
      result = await this.profiles.attachAvatarProjection(
        actorId,
        userId,
        fileId,
        this.requireAvatarUrl(verified),
        reference.id,
      );
    } catch (error) {
      await this.compensateAvatarBinding(userId, reference);
      throw error;
    }
    if (!result.mediaReferenceAccepted) {
      await this.releaseWithRetry(
        reference.id,
        'unused concurrent avatar binding',
      );
    } else if (
      result.previousMediaReferenceId &&
      result.previousMediaReferenceId !== reference.id
    ) {
      await this.releaseWithRetry(
        result.previousMediaReferenceId,
        'old avatar',
      );
    }
    return result.profile;
  }

  async removeAvatar(
    actorId: string,
    userId: string,
  ): Promise<AvatarProjectionMutation['profile']> {
    this.assertOwner(actorId, userId);
    const result = await this.profiles.removeAvatarProjection(
      actorId,
      userId,
    );
    if (result.previousMediaReferenceId) {
      await this.releaseWithRetry(
        result.previousMediaReferenceId,
        'removed avatar',
      );
    }
    return result.profile;
  }

  async createUploadedCv(
    userId: string,
    dto: CreateUploadedCvDto,
  ): Promise<UploadedCvResponseDto> {
    const current = await this.findExactUploadedCv(userId, dto);
    if (current) {
      return this.toCvResponse(current);
    }
    await this.media.verifyUserFile(
      dto.fileId,
      userId,
      ProfileMediaType.CV,
    );
    const cvId = randomUUID();
    const reference = await this.media.bindUserFile(
      dto.fileId,
      userId,
      ProfileMediaType.CV,
      CV_REFERENCE_TYPE,
      cvId,
    );

    let mutation: CvProjectionMutation;
    try {
      mutation = await this.profiles.runMutation(async (transaction) => {
        const locked = await this.lockProfile(transaction, userId);
        const existing = await transaction.cv.findUnique({
          where: { fileId: dto.fileId },
        });
        if (existing) {
          if (
            existing.userId === userId &&
            existing.title === dto.title &&
            existing.type === CvType.UPLOAD &&
            existing.fileUrl === null &&
            existing.mediaReferenceId !== null &&
            !existing.isDeleted
          ) {
            return {
              cv: existing,
              mediaReferenceAccepted: false,
            };
          }
          throw new ApiException(
            'CV_FILE_ALREADY_REGISTERED',
            'This uploaded file is already registered as a CV',
            HttpStatus.CONFLICT,
          );
        }

        const activeCount = await transaction.cv.count({
          where: { userId, isDeleted: false },
        });
        if (activeCount >= CV_LIMIT) {
          throw new ApiException(
            'CV_LIMIT_REACHED',
            `A candidate can keep at most ${CV_LIMIT} active CVs`,
            HttpStatus.CONFLICT,
            { limit: CV_LIMIT },
          );
        }

        const created = await transaction.cv.create({
          data: {
            id: cvId,
            userId,
            title: dto.title,
            type: CvType.UPLOAD,
            fileId: dto.fileId,
            fileUrl: null,
            mediaReferenceId: reference.id,
            isDefault: activeCount === 0,
          },
        });
        if (!locked.created) {
          await transaction.profile.update({
            where: { id: locked.id },
            data: { aggregateVersion: { increment: 1 } },
          });
        }
        return {
          cv: created,
          mediaReferenceAccepted: true,
        };
      });
    } catch (error) {
      await this.compensateCvBinding(reference);
      throw error;
    }
    if (!mutation.mediaReferenceAccepted) {
      await this.releaseWithRetry(
        reference.id,
        'unused concurrent CV binding',
      );
    }
    return this.toCvResponse(mutation.cv);
  }

  async listUploadedCvs(
    userId: string,
  ): Promise<UploadedCvResponseDto[]> {
    const cvs = await this.prisma.$transaction(
      (transaction) =>
        transaction.cv.findMany({
          where: {
            userId,
            type: CvType.UPLOAD,
            fileUrl: null,
            mediaReferenceId: { not: null },
            isDeleted: false,
          },
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return cvs.map((cv) => this.toCvResponse(cv));
  }

  async getUploadedCv(
    userId: string,
    cvId: string,
  ): Promise<UploadedCvResponseDto> {
    return this.toCvResponse(await this.findOwnedCv(userId, cvId));
  }

  async createCvDownloadUrl(
    userId: string,
    cvId: string,
  ): Promise<CvDownloadResponseDto> {
    const cv = await this.findOwnedCv(userId, cvId);
    const download = await this.media.createUserDownloadUrl(
      cv.fileId,
      userId,
      ProfileMediaType.CV,
    );
    return this.toDownloadResponse(download);
  }

  private async lockProfile(
    transaction: Transaction,
    userId: string,
  ): Promise<LockedProfile> {
    const rows = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id"
      FROM "profile"."profiles"
      WHERE "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    if (rows[0]) {
      return { id: rows[0].id, created: false };
    }
    const created = await transaction.profile.create({
      data: {
        userId,
        completionRuleVersion: PROFILE_COMPLETION_RULE_VERSION,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  private async findExactUploadedCv(
    userId: string,
    dto: CreateUploadedCvDto,
  ): Promise<Cv | null> {
    return this.prisma.cv.findFirst({
      where: {
        userId,
        title: dto.title,
        type: CvType.UPLOAD,
        fileId: dto.fileId,
        fileUrl: null,
        mediaReferenceId: { not: null },
        isDeleted: false,
      },
    });
  }

  private async findOwnedCv(userId: string, cvId: string): Promise<Cv> {
    const cv = await this.prisma.cv.findFirst({
      where: {
        id: cvId,
        userId,
        type: CvType.UPLOAD,
        fileUrl: null,
        mediaReferenceId: { not: null },
        isDeleted: false,
      },
    });
    if (!cv) {
      throw new ApiException(
        'CV_NOT_FOUND',
        'The requested CV was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return cv;
  }

  private requireAvatarUrl(file: VerifiedMediaFile): string {
    if (!file.url) {
      throw new ApiException(
        'MEDIA_RESPONSE_INVALID',
        'Media Service did not return a public avatar URL',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return file.url;
  }

  private async compensateAvatarBinding(
    userId: string,
    reference: BoundMediaReference,
  ): Promise<void> {
    let persisted = false;
    let inspected = false;
    try {
      persisted = Boolean(
        await this.prisma.profile.findFirst({
          where: {
            userId,
            avatarMediaReferenceId: reference.id,
          },
          select: { id: true },
        }),
      );
      inspected = true;
    } catch (error) {
      this.logCompensationFailure('inspect avatar binding', error);
    }
    if (inspected && !persisted) {
      await this.releaseWithRetry(reference.id, 'failed avatar write');
    }
  }

  private async compensateCvBinding(
    reference: BoundMediaReference,
  ): Promise<void> {
    let persisted = false;
    let inspected = false;
    try {
      persisted = Boolean(
        await this.prisma.cv.findFirst({
          where: { mediaReferenceId: reference.id },
          select: { id: true },
        }),
      );
      inspected = true;
    } catch (error) {
      this.logCompensationFailure('inspect CV binding', error);
    }
    if (inspected && !persisted) {
      await this.releaseWithRetry(reference.id, 'failed CV write');
    }
  }

  private async releaseWithRetry(
    referenceId: string,
    reason: string,
  ): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.media.releaseReference(referenceId);
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logCompensationFailure(
            `${reason} after ${maxAttempts} attempts`,
            error,
          );
          return;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, attempt * 25);
        });
      }
    }
  }

  private logCompensationFailure(reason: string, error: unknown): void {
    this.logger.error(
      `Media reference cleanup failed (${reason})`,
      error instanceof Error ? error.stack : String(error),
    );
  }

  private toCvResponse(cv: Cv): UploadedCvResponseDto {
    return {
      id: cv.id,
      userId: cv.userId,
      title: cv.title,
      type: 'UPLOAD',
      fileId: cv.fileId,
      fileUrl: null,
      isDefault: cv.isDefault,
      aggregateVersion: cv.aggregateVersion,
      createdAt: cv.createdAt.toISOString(),
      updatedAt: cv.updatedAt.toISOString(),
    };
  }

  private toDownloadResponse(
    download: MediaDownloadUrl,
  ): CvDownloadResponseDto {
    return {
      url: download.url,
      expiresAt: download.expiresAt,
    };
  }

  private assertOwner(actorId: string, userId: string): void {
    if (actorId.toLowerCase() !== userId.toLowerCase()) {
      throw new ApiException(
        'PROFILE_OWNER_REQUIRED',
        'Candidates can only access their own profile',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
