import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cv, CvType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ApiException } from '../common/http/api-exception';
import {
  BoundMediaReference,
  ProfileMediaClient,
  ProfileMediaType,
} from '../media/profile-media.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOnlineCvDto,
  CreateOnlineCvRevisionDto,
  OnlineCvSnapshotDto,
} from './dto/profile-media-input.dto';
import { OnlineCvBuilderResponseDto } from './dto/profile-media-response.dto';
import { PROFILE_COMPLETION_RULE_VERSION } from './profile-completion';
import { ProfileService } from './profile.service';
import {
  ACTIVE_CV_LIMIT,
  RETAINED_CV_SNAPSHOT_LIMIT,
} from './cv-limits';

const CV_REFERENCE_TYPE = 'PROFILE_CV';
const ONLINE_MEDIA_BACKED_CV = {
  type: CvType.ONLINE,
  fileUrl: null,
  mediaReferenceId: { not: null },
} satisfies Prisma.CvWhereInput;

type Transaction = Prisma.TransactionClient;

interface LockedProfile {
  id: string;
  created: boolean;
}

interface BuilderMutation {
  cv: Cv;
  mediaReferenceAccepted: boolean;
}

@Injectable()
export class CvBuilderService {
  private readonly logger = new Logger(CvBuilderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly media: ProfileMediaClient,
  ) {}

  async createOnlineCv(
    userIdInput: string,
    dto: CreateOnlineCvDto,
  ): Promise<OnlineCvBuilderResponseDto> {
    const userId = this.canonicalUuid(userIdInput);
    const fileId = this.canonicalUuid(dto.fileId);
    const current = await this.prisma.cv.findUnique({
      where: { fileId },
    });
    if (current) {
      return this.resolveCreateRetry(current, userId, dto);
    }
    await this.media.verifyUserFile(
      fileId,
      userId,
      ProfileMediaType.CV,
    );
    await this.assertCvFileNotRetired(this.prisma, fileId);
    const cvId = randomUUID();
    const reference = await this.media.bindUserFile(
      fileId,
      userId,
      ProfileMediaType.CV,
      CV_REFERENCE_TYPE,
      cvId,
    );

    let mutation: BuilderMutation;
    try {
      mutation = await this.profiles.runMutation(async (transaction) => {
        const locked = await this.lockProfile(transaction, userId);
        await this.assertCvFileNotRetired(transaction, fileId);
        const concurrent = await transaction.cv.findUnique({
          where: { fileId },
        });
        if (concurrent) {
          this.assertMatchingSnapshot(concurrent, userId, dto, true);
          return {
            cv: concurrent,
            mediaReferenceAccepted: false,
          };
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
        await this.assertSnapshotQuota(transaction, userId);

        const created = await transaction.cv.create({
          data: {
            id: cvId,
            userId,
            title: dto.title,
            type: CvType.ONLINE,
            fileId,
            fileUrl: null,
            mediaReferenceId: reference.id,
            templateId: dto.templateId,
            contentJson: dto.contentJson as Prisma.InputJsonValue,
            contentSchemaVersion: dto.contentSchemaVersion,
            revisionSeriesId: cvId,
            revisionNumber: 1,
            isDefault: activeCount === 0,
          },
        });
        if (!locked.created) {
          await this.bumpProfileVersion(transaction, locked.id);
        }
        await this.assertDeferredInvariants(transaction);
        return { cv: created, mediaReferenceAccepted: true };
      });
    } catch (error) {
      await this.compensateBinding(reference);
      throw error;
    }
    if (!mutation.mediaReferenceAccepted) {
      await this.releaseWithRetry(
        reference.id,
        'unused concurrent Online CV binding',
      );
    }
    return this.toBuilderResponse(mutation.cv);
  }

  async getOnlineCv(
    userIdInput: string,
    cvIdInput: string,
  ): Promise<OnlineCvBuilderResponseDto> {
    const cv = await this.findActiveOnlineCv(
      this.prisma,
      this.canonicalUuid(userIdInput),
      this.canonicalUuid(cvIdInput),
    );
    return this.toBuilderResponse(cv);
  }

  async createRevision(
    userIdInput: string,
    cvIdInput: string,
    dto: CreateOnlineCvRevisionDto,
  ): Promise<OnlineCvBuilderResponseDto> {
    const userId = this.canonicalUuid(userIdInput);
    const sourceId = this.canonicalUuid(cvIdInput);
    const fileId = this.canonicalUuid(dto.fileId);

    const retry = await this.findRevisionRetry(userId, sourceId, dto);
    if (retry) {
      return this.toBuilderResponse(retry);
    }

    const source = await this.findActiveOnlineCv(
      this.prisma,
      userId,
      sourceId,
    );
    this.assertExpectedVersion(source, dto.expectedAggregateVersion);
    if (source.fileId === fileId) {
      throw new ApiException(
        'CV_REVISION_FILE_REQUIRED',
        'A new Online CV revision requires a newly exported PDF fileId',
        HttpStatus.CONFLICT,
      );
    }
    const registeredFile = await this.prisma.cv.findUnique({
      where: { fileId },
      select: { id: true },
    });
    if (registeredFile) {
      throw this.fileAlreadyRegistered();
    }
    await this.media.verifyUserFile(
      fileId,
      userId,
      ProfileMediaType.CV,
    );
    await this.assertCvFileNotRetired(this.prisma, fileId);
    const revisionId = randomUUID();
    const reference = await this.media.bindUserFile(
      fileId,
      userId,
      ProfileMediaType.CV,
      CV_REFERENCE_TYPE,
      revisionId,
    );

    let mutation: BuilderMutation;
    try {
      mutation = await this.profiles.runMutation(async (transaction) => {
        const profileId = await this.lockExistingProfile(
          transaction,
          userId,
        );
        await this.assertCvFileNotRetired(transaction, fileId);
        const concurrent = await this.findRevisionRetry(
          userId,
          sourceId,
          dto,
          transaction,
        );
        if (concurrent) {
          return {
            cv: concurrent,
            mediaReferenceAccepted: false,
          };
        }

        const current = await this.findActiveOnlineCv(
          transaction,
          userId,
          sourceId,
        );
        this.assertExpectedVersion(
          current,
          dto.expectedAggregateVersion,
        );
        const existingFile = await transaction.cv.findUnique({
          where: { fileId },
          select: { id: true },
        });
        if (existingFile) {
          throw this.fileAlreadyRegistered();
        }
        await this.assertSnapshotQuota(transaction, userId);
        const seriesId = this.requireRevisionSeriesId(current);
        const revisionNumber = this.requireRevisionNumber(current) + 1;
        const makeDefault = current.isDefault || dto.makeDefault === true;

        if (dto.makeDefault === true && !current.isDefault) {
          await transaction.cv.updateMany({
            where: {
              userId,
              isDeleted: false,
              isDefault: true,
              id: { not: current.id },
            },
            data: {
              isDefault: false,
              aggregateVersion: { increment: 1 },
            },
          });
        }

        await transaction.cv.update({
          where: { id: current.id },
          data: {
            isDefault: false,
            isDeleted: true,
            deletedAt: new Date(),
            aggregateVersion: { increment: 1 },
          },
        });
        const created = await transaction.cv.create({
          data: {
            id: revisionId,
            userId,
            title: dto.title,
            type: CvType.ONLINE,
            fileId,
            fileUrl: null,
            mediaReferenceId: reference.id,
            templateId: dto.templateId,
            contentJson: dto.contentJson as Prisma.InputJsonValue,
            contentSchemaVersion: dto.contentSchemaVersion,
            revisionSeriesId: seriesId,
            revisionNumber,
            previousRevisionId: current.id,
            isDefault: makeDefault,
          },
        });
        await this.bumpProfileVersion(transaction, profileId);
        await this.assertDeferredInvariants(transaction);
        return { cv: created, mediaReferenceAccepted: true };
      });
    } catch (error) {
      await this.compensateBinding(reference);
      throw error;
    }
    if (!mutation.mediaReferenceAccepted) {
      await this.releaseWithRetry(
        reference.id,
        'unused concurrent Online CV revision binding',
      );
    }
    return this.toBuilderResponse(mutation.cv);
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

  private async assertDeferredInvariants(
    transaction: Transaction,
  ): Promise<void> {
    await transaction.$executeRawUnsafe(
      'SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE',
    );
  }

  private async findActiveOnlineCv(
    client: Pick<PrismaService, 'cv'> | Transaction,
    userId: string,
    cvId: string,
  ): Promise<Cv> {
    const cv = await client.cv.findFirst({
      where: {
        id: cvId,
        userId,
        ...ONLINE_MEDIA_BACKED_CV,
        isDeleted: false,
      },
    });
    if (!cv) {
      throw this.cvNotFound();
    }
    return cv;
  }

  private async findRevisionRetry(
    userId: string,
    sourceId: string,
    dto: CreateOnlineCvRevisionDto,
    client: Pick<PrismaService, 'cv'> | Transaction = this.prisma,
  ): Promise<Cv | null> {
    const successor = await client.cv.findUnique({
      where: { previousRevisionId: sourceId },
    });
    if (!successor || successor.userId !== userId) {
      return null;
    }
    if (
      successor.isDeleted ||
      !this.isMatchingSnapshot(successor, userId, dto) ||
      (dto.makeDefault === true && !successor.isDefault)
    ) {
      throw new ApiException(
        'CV_REVISION_ALREADY_CREATED',
        'This CV already has a different successor revision',
        HttpStatus.CONFLICT,
      );
    }
    const predecessor = await client.cv.findFirst({
      where: { id: sourceId, userId },
    });
    if (
      !predecessor ||
      !predecessor.isDeleted ||
      predecessor.aggregateVersion !==
        dto.expectedAggregateVersion + 1
    ) {
      throw new ApiException(
        'CV_REVISION_STATE_INVALID',
        'The CV revision chain is inconsistent',
        HttpStatus.CONFLICT,
      );
    }
    return successor;
  }

  private async assertSnapshotQuota(
    transaction: Transaction,
    userId: string,
  ): Promise<void> {
    const retainedCount = await transaction.cv.count({ where: { userId } });
    if (retainedCount >= RETAINED_CV_SNAPSHOT_LIMIT) {
      throw new ApiException(
        'CV_SNAPSHOT_LIMIT_REACHED',
        `A candidate can retain at most ${RETAINED_CV_SNAPSHOT_LIMIT} CV snapshots`,
        HttpStatus.CONFLICT,
        { limit: RETAINED_CV_SNAPSHOT_LIMIT },
      );
    }
  }

  private resolveCreateRetry(
    cv: Cv,
    userId: string,
    dto: CreateOnlineCvDto,
  ): OnlineCvBuilderResponseDto {
    this.assertMatchingSnapshot(cv, userId, dto, true);
    return this.toBuilderResponse(cv);
  }

  private assertMatchingSnapshot(
    cv: Cv,
    userId: string,
    dto: OnlineCvSnapshotDto,
    requireRoot: boolean,
  ): void {
    if (
      cv.isDeleted ||
      !this.isMatchingSnapshot(cv, userId, dto) ||
      (requireRoot &&
        (cv.revisionNumber !== 1 ||
          cv.previousRevisionId !== null))
    ) {
      throw this.fileAlreadyRegistered();
    }
  }

  private isMatchingSnapshot(
    cv: Cv,
    userId: string,
    dto: OnlineCvSnapshotDto,
  ): boolean {
    return (
      cv.userId === userId &&
      cv.type === CvType.ONLINE &&
      cv.fileId === this.canonicalUuid(dto.fileId) &&
      cv.fileUrl === null &&
      cv.mediaReferenceId !== null &&
      cv.title === dto.title &&
      cv.templateId === dto.templateId &&
      cv.contentSchemaVersion === dto.contentSchemaVersion &&
      this.canonicalJson(cv.contentJson) ===
        this.canonicalJson(dto.contentJson)
    );
  }

  private assertExpectedVersion(
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

  private requireRevisionSeriesId(cv: Cv): string {
    if (!cv.revisionSeriesId) {
      throw this.invalidBuilderState();
    }
    return cv.revisionSeriesId;
  }

  private requireRevisionNumber(cv: Cv): number {
    if (!cv.revisionNumber || cv.revisionNumber < 1) {
      throw this.invalidBuilderState();
    }
    return cv.revisionNumber;
  }

  private toBuilderResponse(cv: Cv): OnlineCvBuilderResponseDto {
    if (
      cv.type !== CvType.ONLINE ||
      cv.fileUrl !== null ||
      cv.mediaReferenceId === null ||
      cv.templateId === null ||
      cv.contentSchemaVersion === null ||
      cv.contentJson === null ||
      Array.isArray(cv.contentJson) ||
      typeof cv.contentJson !== 'object'
    ) {
      throw this.invalidBuilderState();
    }
    return {
      id: cv.id,
      userId: cv.userId,
      title: cv.title,
      type: 'ONLINE',
      fileId: cv.fileId,
      fileUrl: null,
      templateId: cv.templateId,
      contentSchemaVersion: cv.contentSchemaVersion,
      contentJson: cv.contentJson as Record<string, unknown>,
      revisionSeriesId: this.requireRevisionSeriesId(cv),
      revisionNumber: this.requireRevisionNumber(cv),
      previousRevisionId: cv.previousRevisionId,
      isDefault: cv.isDefault,
      aggregateVersion: cv.aggregateVersion,
      createdAt: cv.createdAt.toISOString(),
      updatedAt: cv.updatedAt.toISOString(),
    };
  }

  private canonicalJson(value: unknown): string {
    const normalize = (item: unknown): unknown => {
      if (Array.isArray(item)) {
        return item.map(normalize);
      }
      if (item !== null && typeof item === 'object') {
        return Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, normalize(child)]),
        );
      }
      return item;
    };
    return JSON.stringify(normalize(value));
  }

  private async compensateBinding(
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
      this.logCleanupFailure('inspect Online CV binding', error);
    }
    if (inspected && !persisted) {
      await this.releaseWithRetry(reference.id, 'failed Online CV write');
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
          this.logCleanupFailure(
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

  private logCleanupFailure(reason: string, error: unknown): void {
    this.logger.error(
      `Media reference cleanup failed (${reason})`,
      error instanceof Error ? error.stack : String(error),
    );
  }

  private fileAlreadyRegistered(): ApiException {
    return new ApiException(
      'CV_FILE_ALREADY_REGISTERED',
      'This PDF file is already registered as a CV snapshot',
      HttpStatus.CONFLICT,
    );
  }

  private cvNotFound(): ApiException {
    return new ApiException(
      'CV_NOT_FOUND',
      'The requested Online CV was not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private invalidBuilderState(): ApiException {
    return new ApiException(
      'CV_BUILDER_STATE_INVALID',
      'The Online CV builder snapshot is inconsistent',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private canonicalUuid(value: string): string {
    return value.toLowerCase();
  }
}
