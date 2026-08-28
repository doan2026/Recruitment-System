import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  Cv,
  CvEventAction,
  CvType,
  Prisma,
} from '@prisma/client';
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
import {
  CreateUploadedCvDto,
  RenameUploadedCvDto,
} from './dto/profile-media-input.dto';
import {
  CvDownloadResponseDto,
  DeletedCvResponseDto,
  UploadedCvResponseDto,
} from './dto/profile-media-response.dto';
import { PROFILE_COMPLETION_RULE_VERSION } from './profile-completion';
import {
  AvatarProjectionMutation,
  ProfileService,
} from './profile.service';
import {
  ACTIVE_CV_LIMIT,
  RETAINED_CV_SNAPSHOT_LIMIT,
} from './cv-limits';
import { CvDeletionService } from './cv-deletion.service';
import { CvEventPublisherService } from './cv-event-publisher.service';

const AVATAR_REFERENCE_TYPE = 'PROFILE_AVATAR';
const CV_REFERENCE_TYPE = 'PROFILE_CV';
const MEDIA_BACKED_CV = {
  type: { in: [CvType.UPLOAD, CvType.ONLINE] },
  fileUrl: null,
  mediaReferenceId: { not: null },
} satisfies Prisma.CvWhereInput;

type Transaction = Prisma.TransactionClient;

interface LockedProfile {
  id: string;
  created: boolean;
}

interface CvProjectionMutation {
  cv: Cv;
  mediaReferenceAccepted: boolean;
  eventAppended: boolean;
}

@Injectable()
export class ProfileMediaService {
  private readonly logger = new Logger(ProfileMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly media: ProfileMediaClient,
    private readonly deletions: CvDeletionService,
    private readonly events: CvEventPublisherService,
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
    await this.assertCvFileNotRetired(this.prisma, dto.fileId);
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
        await this.assertCvFileNotRetired(
          transaction,
          dto.fileId,
        );
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
              eventAppended: false,
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
        if (activeCount >= ACTIVE_CV_LIMIT) {
          throw new ApiException(
            'CV_LIMIT_REACHED',
            `A candidate can keep at most ${ACTIVE_CV_LIMIT} active CVs`,
            HttpStatus.CONFLICT,
            { limit: ACTIVE_CV_LIMIT },
          );
        }
        const retainedCount = await transaction.cv.count({
          where: { userId },
        });
        if (retainedCount >= RETAINED_CV_SNAPSHOT_LIMIT) {
          throw new ApiException(
            'CV_SNAPSHOT_LIMIT_REACHED',
            `A candidate can retain at most ${RETAINED_CV_SNAPSHOT_LIMIT} CV snapshots`,
            HttpStatus.CONFLICT,
            { limit: RETAINED_CV_SNAPSHOT_LIMIT },
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
        await this.events.append(
          transaction,
          created,
          CvEventAction.UPSERTED,
        );
        if (!locked.created) {
          await transaction.profile.update({
            where: { id: locked.id },
            data: { aggregateVersion: { increment: 1 } },
          });
        }
        await this.assertCvDefaultInvariant(transaction);
        return {
          cv: created,
          mediaReferenceAccepted: true,
          eventAppended: true,
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
    if (mutation.eventAppended) this.events.wake();
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
            ...MEDIA_BACKED_CV,
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

  async renameUploadedCv(
    userIdInput: string,
    cvIdInput: string,
    dto: RenameUploadedCvDto,
  ): Promise<UploadedCvResponseDto> {
    const userId = this.canonicalUuid(userIdInput);
    const cvId = this.canonicalUuid(cvIdInput);
    return this.profiles.runMutation(async (transaction) => {
      const profileId = await this.lockExistingProfile(
        transaction,
        userId,
      );
      const cv = await this.findLifecycleCv(
        transaction,
        userId,
        cvId,
        false,
      );
      if (cv.title === dto.title) {
        return this.toCvResponse(cv);
      }
      this.assertExpectedCvVersion(cv, dto.expectedAggregateVersion);

      const updated = await transaction.cv.update({
        where: { id: cv.id },
        data: {
          title: dto.title,
          aggregateVersion: { increment: 1 },
        },
      });
      await this.bumpProfileVersion(transaction, profileId);
      await this.assertCvDefaultInvariant(transaction);
      return this.toCvResponse(updated);
    });
  }

  async setDefaultUploadedCv(
    userIdInput: string,
    cvIdInput: string,
    expectedAggregateVersion: number,
  ): Promise<UploadedCvResponseDto> {
    const userId = this.canonicalUuid(userIdInput);
    const cvId = this.canonicalUuid(cvIdInput);
    return this.profiles.runMutation(async (transaction) => {
      const profileId = await this.lockExistingProfile(
        transaction,
        userId,
      );
      const target = await this.findLifecycleCv(
        transaction,
        userId,
        cvId,
        false,
      );
      if (target.isDefault) {
        return this.toCvResponse(target);
      }
      this.assertExpectedCvVersion(target, expectedAggregateVersion);

      await transaction.cv.updateMany({
        where: {
          userId,
          isDeleted: false,
          isDefault: true,
          id: { not: target.id },
        },
        data: {
          isDefault: false,
          aggregateVersion: { increment: 1 },
        },
      });
      const updated = await transaction.cv.update({
        where: { id: target.id },
        data: {
          isDefault: true,
          aggregateVersion: { increment: 1 },
        },
      });
      await this.bumpProfileVersion(transaction, profileId);
      await this.assertCvDefaultInvariant(transaction);
      return this.toCvResponse(updated);
    });
  }

  async deleteUploadedCv(
    userIdInput: string,
    cvIdInput: string,
    expectedAggregateVersion: number,
  ): Promise<DeletedCvResponseDto> {
    return this.deletions.deleteCv(
      userIdInput,
      cvIdInput,
      expectedAggregateVersion,
    );
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

  private async lockExistingProfile(
    transaction: Transaction,
    userId: string,
  ): Promise<string> {
    const rows = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id"
      FROM "profile"."profiles"
      WHERE "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    if (!rows[0]) {
      throw this.cvNotFound();
    }
    return rows[0].id;
  }

  private async bumpProfileVersion(
    transaction: Transaction,
    profileId: string,
  ): Promise<void> {
    await transaction.profile.update({
      where: { id: profileId },
      data: { aggregateVersion: { increment: 1 } },
    });
  }

  private async assertCvDefaultInvariant(
    transaction: Transaction,
  ): Promise<void> {
    // Prisma interactive transactions can otherwise resolve before surfacing
    // an error raised only by an INITIALLY DEFERRED trigger at COMMIT.
    await transaction.$executeRawUnsafe(
      'SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE',
    );
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

  private async assertCvFileNotRetired(
    client:
      | Pick<PrismaService, 'cvDeletionWorkflow'>
      | Transaction,
    fileId: string,
  ): Promise<void> {
    const retired = await client.cvDeletionWorkflow.findUnique({
      where: { fileId },
      select: { cvId: true },
    });
    if (retired) {
      throw new ApiException(
        'CV_FILE_RETIRED',
        'A file from a hard-deletion workflow cannot be registered again',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async findOwnedCv(userId: string, cvId: string): Promise<Cv> {
    const cv = await this.prisma.cv.findFirst({
      where: {
        id: cvId,
        userId,
        ...MEDIA_BACKED_CV,
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

  private async findLifecycleCv(
    client: Pick<PrismaService, 'cv'> | Transaction,
    userId: string,
    cvId: string,
    includeDeleted: boolean,
  ): Promise<Cv> {
    const cv = await client.cv.findFirst({
      where: {
        id: cvId,
        userId,
        ...MEDIA_BACKED_CV,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
    });
    if (!cv) {
      throw this.cvNotFound();
    }
    return cv;
  }

  private assertExpectedCvVersion(
    cv: Cv,
    expectedAggregateVersion: number,
  ): void {
    if (cv.aggregateVersion !== expectedAggregateVersion) {
      throw new ApiException(
        'CV_VERSION_CONFLICT',
        'The CV changed after it was read; reload it and retry',
        HttpStatus.CONFLICT,
        {
          expectedAggregateVersion,
          actualAggregateVersion: cv.aggregateVersion,
        },
      );
    }
  }

  private cvNotFound(): ApiException {
    return new ApiException(
      'CV_NOT_FOUND',
      'The requested CV was not found',
      HttpStatus.NOT_FOUND,
    );
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
    if (!cv.revisionSeriesId || !cv.revisionNumber) {
      throw new ApiException(
        'CV_REVISION_STATE_INVALID',
        'The CV revision lineage is inconsistent',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return {
      id: cv.id,
      userId: cv.userId,
      title: cv.title,
      type: cv.type,
      fileId: cv.fileId,
      fileUrl: null,
      templateId: cv.templateId,
      contentSchemaVersion: cv.contentSchemaVersion,
      revisionSeriesId: cv.revisionSeriesId,
      revisionNumber: cv.revisionNumber,
      previousRevisionId: cv.previousRevisionId,
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

  private canonicalUuid(value: string): string {
    return value.toLowerCase();
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
