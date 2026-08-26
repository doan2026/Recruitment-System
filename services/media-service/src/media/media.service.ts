import {
  FileMeta,
  FileReference,
  FileOwnerType,
  FileStatus,
  MediaType,
  Prisma,
  StorageDeliveryType,
  StorageResourceType,
} from '@prisma/client';
import {
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AuthUser,
  InternalCaller,
} from '../common/auth/auth-context';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssetLocator,
  InspectedAsset,
  SignedUploadCapability,
  StorageAssetMismatchError,
  StorageAssetNotFoundError,
  StorageProvider,
  StorageUnavailableError,
} from '../storage/storage-provider';
import {
  BindFileReferenceDto,
  CreateUploadIntentDto,
  InternalCreateUploadIntentDto,
  InternalFileExpectationDto,
} from './dto/media-input.dto';
import {
  DownloadUrlDto,
  FileMetadataDto,
  FileReferenceDto,
} from './dto/media-response.dto';
import {
  assertInternalConsumerAllowed,
  assertInternalProducerAllowed,
  assertPublicUploadAllowed,
  getMediaPolicy,
  matchesMagicBytes,
  mimeForFormat,
  validateOriginalFilename,
} from './media-policy';

export const MEDIA_CLOCK = Symbol('MEDIA_CLOCK');

const INTENT_TTL_MS = 10 * 60 * 1000;
const CLOUDINARY_DOCUMENTED_WINDOW_SECONDS = 60 * 60;
const PROVIDER_WINDOW_SECONDS = 10 * 60;
const MAX_PENDING_INTENTS_PER_USER_AND_TYPE = 20;
const MAX_UPLOAD_INTENTS_PER_REQUESTER_PER_HOUR = 60;
const UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
const DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const CONFIRM_RETRY_BASE_MS = 5 * 1000;
const CONFIRM_RETRY_MAX_MS = 60 * 1000;
const MAX_TRANSACTION_ATTEMPTS = 5;
const OPERATION_LEASE_MS = 5 * 60 * 1000;
const MAX_IMAGE_PIXELS = 25_000_000;
const DELETABLE_STATUSES = new Set<FileStatus>([
  FileStatus.PENDING,
  FileStatus.ACTIVE,
  FileStatus.EXPIRED,
  FileStatus.REJECTED,
  FileStatus.DELETE_FAILED,
]);

interface CreateIntentContext {
  requestedBy: string;
  ownerId: string;
  ownerType: FileOwnerType;
  producerService: string | null;
  idempotencyKey?: string;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    @Inject(MEDIA_CLOCK)
    private readonly clock: () => Date,
  ) {}

  async createPublicIntent(
    user: AuthUser,
    input: CreateUploadIntentDto,
    idempotencyHeader: string | string[] | undefined,
  ): Promise<SignedUploadCapability> {
    assertPublicUploadAllowed(user.systemRole, input.type);
    return this.createIntent(
      {
        requestedBy: user.id,
        ownerId: user.id,
        ownerType: FileOwnerType.USER,
        producerService: null,
        idempotencyKey:
          this.normalizeIdempotencyKey(idempotencyHeader),
      },
      input,
    );
  }

  async createInternalIntent(
    caller: InternalCaller,
    input: InternalCreateUploadIntentDto,
    idempotencyHeader: string | string[] | undefined,
  ): Promise<SignedUploadCapability> {
    assertInternalProducerAllowed(
      caller.service,
      input.type,
      input.ownerType,
    );
    return this.createIntent(
      {
        requestedBy: input.requestedBy,
        ownerId: input.ownerId,
        ownerType: input.ownerType,
        producerService: caller.service,
        idempotencyKey:
          this.normalizeIdempotencyKey(idempotencyHeader),
      },
      input,
    );
  }

  async confirmPublic(
    user: AuthUser,
    fileId: string,
  ): Promise<FileMetadataDto> {
    const file = await this.findFile(fileId);
    this.assertPublicOwner(file, user);
    return this.confirm(file);
  }

  async confirmInternal(
    caller: InternalCaller,
    fileId: string,
  ): Promise<FileMetadataDto> {
    const file = await this.findFile(fileId);
    assertInternalProducerAllowed(
      caller.service,
      file.mediaType,
      file.ownerType,
    );
    return this.confirm(file);
  }

  async getPublic(
    user: AuthUser,
    fileId: string,
  ): Promise<FileMetadataDto> {
    const file = await this.findFile(fileId);
    this.assertPublicOwner(file, user);
    if (file.status === FileStatus.DELETED) {
      throw this.notFound();
    }
    return this.toMetadata(file);
  }

  async verifyInternal(
    caller: InternalCaller,
    expected: InternalFileExpectationDto,
  ): Promise<FileMetadataDto> {
    const file = await this.findFile(expected.fileId);
    assertInternalConsumerAllowed(caller.service, file.mediaType);
    this.assertExpectation(file, expected);
    if (file.status !== FileStatus.ACTIVE) {
      throw new ApiException(
        'FILE_NOT_ACTIVE',
        'The file is not active',
        HttpStatus.CONFLICT,
        { status: file.status },
      );
    }
    return this.toMetadata(file);
  }

  async createPublicDownloadUrl(
    user: AuthUser,
    fileId: string,
  ): Promise<DownloadUrlDto> {
    const file = await this.findFile(fileId);
    this.assertPublicOwner(file, user);
    return this.createDownloadUrl(file);
  }

  async createInternalDownloadUrl(
    caller: InternalCaller,
    expected: InternalFileExpectationDto,
  ): Promise<DownloadUrlDto> {
    const file = await this.findFile(expected.fileId);
    assertInternalConsumerAllowed(caller.service, file.mediaType);
    this.assertExpectation(file, expected);
    return this.createDownloadUrl(file);
  }

  async bindReference(
    caller: InternalCaller,
    input: BindFileReferenceDto,
  ): Promise<FileReferenceDto> {
    const file = await this.findFile(input.fileId);
    assertInternalConsumerAllowed(caller.service, file.mediaType);
    this.assertExpectation(file, input);
    if (file.status !== FileStatus.ACTIVE) {
      throw new ApiException(
        'FILE_NOT_ACTIVE',
        'Only an active file can be referenced',
        HttpStatus.CONFLICT,
      );
    }

    const reference = await this.withTransactionRetry(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id"
          FROM "media"."file_meta"
          WHERE "id" = ${input.fileId}::uuid
          FOR UPDATE`,
      );
      const lockedFile = await tx.fileMeta.findUnique({
        where: { id: input.fileId },
      });
      if (!lockedFile || lockedFile.status !== FileStatus.ACTIVE) {
        throw new ApiException(
          'FILE_NOT_ACTIVE',
          'Only an active file can be referenced',
          HttpStatus.CONFLICT,
        );
      }

      const inserted = await tx.$queryRaw<FileReference[]>(
        Prisma.sql`INSERT INTO "media"."file_reference" (
          "id", "file_id", "caller_service", "reference_type", "reference_id"
        ) VALUES (
          ${randomUUID()}::uuid,
          ${input.fileId}::uuid,
          ${caller.service},
          ${input.referenceType},
          ${input.referenceId}
        )
        ON CONFLICT (
          "file_id", "caller_service", "reference_type", "reference_id"
        ) DO NOTHING
        RETURNING
          "id",
          "file_id" AS "fileId",
          "caller_service" AS "callerService",
          "reference_type" AS "referenceType",
          "reference_id" AS "referenceId",
          "created_at" AS "createdAt"`,
      );
      if (inserted[0]) {
        return inserted[0];
      }
      const existing = await tx.fileReference.findFirst({
        where: {
          fileId: input.fileId,
          callerService: caller.service,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
        },
      });
      if (!existing) {
        throw new Error('Reference conflict could not be resolved');
      }
      return existing;
    });
    return {
      id: reference.id,
      fileId: reference.fileId,
      callerService: reference.callerService,
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      createdAt: reference.createdAt.toISOString(),
    };
  }

  async releaseReference(
    caller: InternalCaller,
    referenceId: string,
  ): Promise<{ released: true }> {
    await this.prisma.fileReference.deleteMany({
      where: {
        id: referenceId,
        callerService: caller.service,
      },
    });
    return { released: true };
  }

  async deletePublic(
    user: AuthUser,
    fileId: string,
  ): Promise<FileMetadataDto> {
    const initial = await this.findFile(fileId);
    this.assertPublicOwner(initial, user);
    return this.deleteFile(fileId);
  }

  async deleteInternal(
    caller: InternalCaller,
    fileId: string,
  ): Promise<FileMetadataDto> {
    const initial = await this.findFile(fileId);
    assertInternalProducerAllowed(
      caller.service,
      initial.mediaType,
      initial.ownerType,
    );
    return this.deleteFile(fileId);
  }

  private async createIntent(
    context: CreateIntentContext,
    input: CreateUploadIntentDto,
  ): Promise<SignedUploadCapability> {
    const policy = getMediaPolicy(input.type);
    if (!policy.ownerTypes.includes(context.ownerType)) {
      throw new ApiException(
        'FILE_SCOPE_INVALID',
        'The owner type does not match the media type',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const filename = validateOriginalFilename(
      input.originalFilename,
      policy,
    );

    let uploadPreset: string;
    try {
      uploadPreset = this.storage.getUploadPreset(policy);
    } catch (error) {
      throw this.storageUnavailable(error);
    }

    const now = this.clock();
    const typeLockScope =
      context.requestedBy + ':type:' + input.type;
    const existingOrCreated = await this.withTransactionRetry(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${context.requestedBy + ':upload-rate'}, 0
            )
          )::text AS "lock"`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(
            hashtextextended(${typeLockScope}, 0)
          )::text AS "lock"`,
        );

        if (context.idempotencyKey) {
          const idempotencyLockScope =
            context.requestedBy +
            ':idempotency:' +
            context.idempotencyKey;
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(
              hashtextextended(${idempotencyLockScope}, 0)
            )::text AS "lock"`,
          );
          const existing = await tx.fileMeta.findFirst({
            where: {
              requestedBy: context.requestedBy,
              idempotencyKey: context.idempotencyKey,
            },
          });
          if (existing) {
            if (
              existing.producerService !== context.producerService ||
              existing.ownerId !== context.ownerId ||
              existing.ownerType !== context.ownerType ||
              existing.mediaType !== input.type ||
              existing.originalFilename !== filename.originalFilename ||
              existing.expectedFormat !== filename.format
            ) {
              throw new ApiException(
                'FILE_IDEMPOTENCY_CONFLICT',
                'The idempotency key belongs to a different upload request',
                HttpStatus.CONFLICT,
              );
            }
            if (
              existing.status !== FileStatus.PENDING ||
              existing.intentExpiresAt.getTime() <= now.getTime()
            ) {
              throw new ApiException(
                'FILE_IDEMPOTENCY_KEY_USED',
                'The idempotency key belongs to a completed or expired intent',
                HttpStatus.CONFLICT,
              );
            }
            return existing;
          }
        }

        const recentIntentCount = await tx.fileMeta.count({
          where: {
            requestedBy: context.requestedBy,
            createdAt: {
              gte: new Date(now.getTime() - UPLOAD_RATE_WINDOW_MS),
            },
          },
        });
        if (
          recentIntentCount >=
          MAX_UPLOAD_INTENTS_PER_REQUESTER_PER_HOUR
        ) {
          throw new ApiException(
            'FILE_UPLOAD_RATE_LIMITED',
            'The requester has created too many upload intents',
            HttpStatus.TOO_MANY_REQUESTS,
            {
              limit: MAX_UPLOAD_INTENTS_PER_REQUESTER_PER_HOUR,
              windowSeconds: UPLOAD_RATE_WINDOW_MS / 1000,
            },
          );
        }

        const pendingCount = await tx.fileMeta.count({
          where: {
            requestedBy: context.requestedBy,
            mediaType: input.type,
            status: {
              in: [FileStatus.PENDING, FileStatus.VERIFYING],
            },
            intentExpiresAt: { gt: now },
          },
        });
        if (
          pendingCount >= MAX_PENDING_INTENTS_PER_USER_AND_TYPE
        ) {
          throw new ApiException(
            'FILE_PENDING_LIMIT_REACHED',
            'Too many upload intents are pending for this file type',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        if (policy.maxActivePerOwner) {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(
              hashtextextended(${context.ownerId + ':' + input.type}, 0)
            )::text AS "lock"`,
          );
          const reservedCount = await tx.fileMeta.count({
            where: {
              ownerId: context.ownerId,
              ownerType: context.ownerType,
              mediaType: input.type,
              status: {
                in: [
                  FileStatus.PENDING,
                  FileStatus.VERIFYING,
                  FileStatus.ACTIVE,
                ],
              },
              OR: [
                { status: FileStatus.ACTIVE },
                { intentExpiresAt: { gt: now } },
              ],
            },
          });
          if (reservedCount >= policy.maxActivePerOwner) {
            throw new ApiException(
              'FILE_LIMIT_REACHED',
              'The owner has reached the limit for this media type',
              HttpStatus.CONFLICT,
              { limit: policy.maxActivePerOwner },
            );
          }
        }

        const id = randomUUID();
        const suffix =
          policy.resourceType === StorageResourceType.RAW
            ? '.' + filename.format
            : '';
        const publicId =
          policy.folder + '/' + id + suffix;
        const nowSeconds = Math.floor(now.getTime() / 1000);
        const signatureTimestamp =
          nowSeconds -
          (CLOUDINARY_DOCUMENTED_WINDOW_SECONDS -
            PROVIDER_WINDOW_SECONDS);

        return tx.fileMeta.create({
          data: {
            id,
            requestedBy: context.requestedBy,
            producerService: context.producerService,
            ownerId: context.ownerId,
            ownerType: context.ownerType,
            mediaType: input.type,
            publicId,
            folder: policy.folder,
            originalFilename: filename.originalFilename,
            expectedFormat: filename.format,
            storageResourceType: policy.resourceType,
            storageDeliveryType: policy.deliveryType,
            uploadPreset,
            idempotencyKey: context.idempotencyKey,
            signatureTimestamp,
            intentExpiresAt: new Date(
              now.getTime() + INTENT_TTL_MS,
            ),
            createdAt: now,
            updatedAt: now,
          },
        });
      },
    );

    const effectivePolicy = getMediaPolicy(
      existingOrCreated.mediaType,
    );
    try {
      return this.storage.signUpload({
        fileId: existingOrCreated.id,
        publicId: existingOrCreated.publicId,
        folder: existingOrCreated.folder,
        expectedFormat: existingOrCreated.expectedFormat,
        uploadPreset: existingOrCreated.uploadPreset,
        signatureTimestamp:
          existingOrCreated.signatureTimestamp,
        intentExpiresAt: existingOrCreated.intentExpiresAt,
        policy: effectivePolicy,
      });
    } catch (error) {
      throw this.storageUnavailable(error);
    }
  }

  private async confirm(file: FileMeta): Promise<FileMetadataDto> {
    if (file.status === FileStatus.ACTIVE) {
      return this.toMetadata(file);
    }

    const now = this.clock();
    let claimedFile: FileMeta;
    if (file.status === FileStatus.VERIFYING) {
      const resumed = await this.prisma.fileMeta.updateMany({
        where: {
          id: file.id,
          status: FileStatus.VERIFYING,
          aggregateVersion: file.aggregateVersion,
          updatedAt: {
            lte: new Date(now.getTime() - OPERATION_LEASE_MS),
          },
        },
        data: {
          confirmationAttempts: { increment: 1 },
          confirmationRetryAt: null,
          lastErrorCode: null,
          aggregateVersion: { increment: 1 },
        },
      });
      if (resumed.count !== 1) {
        return this.resolveConfirmationFenceLoss(file.id);
      }
      claimedFile = await this.findFile(file.id);
    } else {
      if (
        file.status === FileStatus.PENDING &&
        file.intentExpiresAt.getTime() <= now.getTime()
      ) {
        const expired = await this.prisma.fileMeta.updateMany({
          where: {
            id: file.id,
            status: FileStatus.PENDING,
            aggregateVersion: file.aggregateVersion,
          },
          data: {
            status: FileStatus.EXPIRED,
            confirmationRetryAt: null,
            lastErrorCode: 'FILE_INTENT_EXPIRED',
            aggregateVersion: { increment: 1 },
          },
        });
        if (expired.count !== 1) {
          return this.resolveConfirmationFenceLoss(file.id);
        }
        throw new ApiException(
          'FILE_INTENT_EXPIRED',
          'The upload intent has expired',
          HttpStatus.GONE,
        );
      }

      if (file.status !== FileStatus.PENDING) {
        throw new ApiException(
          'FILE_CONFIRMATION_NOT_ALLOWED',
          'The file cannot be confirmed in its current state',
          HttpStatus.CONFLICT,
          { status: file.status },
        );
      }
      if (
        file.confirmationRetryAt &&
        file.confirmationRetryAt.getTime() > now.getTime()
      ) {
        throw new ApiException(
          'FILE_CONFIRM_RETRY_LATER',
          'The upload confirmation is temporarily rate limited',
          HttpStatus.TOO_MANY_REQUESTS,
          {
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (file.confirmationRetryAt.getTime() - now.getTime()) /
                  1000,
              ),
            ),
          },
        );
      }

      const claimed = await this.prisma.fileMeta.updateMany({
        where: {
          id: file.id,
          status: FileStatus.PENDING,
          aggregateVersion: file.aggregateVersion,
          intentExpiresAt: { gt: now },
        },
        data: {
          status: FileStatus.VERIFYING,
          confirmationAttempts: { increment: 1 },
          confirmationRetryAt: null,
          lastErrorCode: null,
          aggregateVersion: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        return this.resolveConfirmationFenceLoss(file.id);
      }
      claimedFile = await this.findFile(file.id);
    }

    const locator = this.toLocator(claimedFile);
    let inspected: InspectedAsset;
    try {
      inspected = await this.storage.inspectAsset(locator);
      this.assertInspectedAsset(claimedFile, inspected);
    } catch (error) {
      if (error instanceof StorageAssetNotFoundError) {
        const restored = await this.restorePending(
          claimedFile,
          'FILE_UPLOAD_NOT_FOUND',
          now,
        );
        if (!restored) {
          return this.resolveConfirmationFenceLoss(file.id);
        }
        throw new ApiException(
          'FILE_UPLOAD_NOT_FOUND',
          'The uploaded asset was not found',
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof StorageUnavailableError) {
        const restored = await this.restorePending(
          claimedFile,
          'STORAGE_UNAVAILABLE',
          now,
        );
        if (!restored) {
          return this.resolveConfirmationFenceLoss(file.id);
        }
        throw this.storageUnavailable(error);
      }

      const apiError =
        error instanceof ApiException
          ? error
          : new ApiException(
              'FILE_UPLOAD_MISMATCH',
              error instanceof StorageAssetMismatchError
                ? 'An uploaded asset used an unexpected storage resource type'
                : 'The uploaded asset does not match the intent',
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
      const rejected = await this.rejectFile(
        claimedFile,
        this.apiCode(apiError),
      );
      if (!rejected) {
        return this.resolveConfirmationFenceLoss(file.id);
      }
      try {
        await this.storage.deleteIntentAssets(file.id);
      } catch {
        // Rejected provider objects are retried by the orphan-cleanup task.
      }
      throw apiError;
    }

    let finalization: 'ACTIVATED' | 'QUOTA_REJECTED' | 'FENCE_LOST';
    try {
      finalization = await this.withTransactionRetry(async (tx) => {
        const policy = getMediaPolicy(claimedFile.mediaType);
        if (policy.maxActivePerOwner) {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(
              hashtextextended(
                ${claimedFile.ownerId + ':' + claimedFile.mediaType}, 0
              )
            )::text AS "lock"`,
          );
          const activeCount = await tx.fileMeta.count({
            where: {
              id: { not: claimedFile.id },
              ownerId: claimedFile.ownerId,
              ownerType: claimedFile.ownerType,
              mediaType: claimedFile.mediaType,
              status: FileStatus.ACTIVE,
            },
          });
          if (activeCount >= policy.maxActivePerOwner) {
            const rejected = await tx.fileMeta.updateMany({
              where: {
                id: claimedFile.id,
                status: FileStatus.VERIFYING,
                aggregateVersion: claimedFile.aggregateVersion,
              },
              data: {
                status: FileStatus.REJECTED,
                confirmationRetryAt: null,
                lastErrorCode: 'FILE_LIMIT_REACHED',
                aggregateVersion: { increment: 1 },
              },
            });
            return rejected.count === 1
              ? 'QUOTA_REJECTED'
              : 'FENCE_LOST';
          }
        }

        const updated = await tx.fileMeta.updateMany({
          where: {
            id: claimedFile.id,
            status: FileStatus.VERIFYING,
            aggregateVersion: claimedFile.aggregateVersion,
          },
          data: {
            status: FileStatus.ACTIVE,
            assetId: inspected.assetId,
            providerVersion: inspected.version,
            canonicalUrl: inspected.canonicalUrl,
            mimeType: mimeForFormat(inspected.format),
            format: inspected.format,
            bytes: inspected.bytes,
            width: inspected.width,
            height: inspected.height,
            durationSeconds: inspected.durationSeconds,
            etag: inspected.etag,
            confirmedAt: now,
            confirmationRetryAt: null,
            lastErrorCode: null,
            aggregateVersion: { increment: 1 },
          },
        });
        return updated.count === 1 ? 'ACTIVATED' : 'FENCE_LOST';
      });
    } catch (error) {
      const rejected = await this.rejectFile(
        claimedFile,
        this.isUniqueConflict(error)
          ? 'FILE_PROVIDER_IDENTITY_REUSED'
          : 'FILE_CONFIRMATION_FAILED',
      );
      if (!rejected) {
        return this.resolveConfirmationFenceLoss(file.id);
      }
      if (this.isUniqueConflict(error)) {
        throw new ApiException(
          'FILE_UPLOAD_MISMATCH',
          'The provider asset identity is already registered',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw error;
    }

    if (finalization === 'FENCE_LOST') {
      return this.resolveConfirmationFenceLoss(file.id);
    }
    if (finalization === 'QUOTA_REJECTED') {
      try {
        await this.storage.deleteIntentAssets(file.id);
      } catch {
        // Rejected provider objects are retried by the orphan-cleanup task.
      }
      throw new ApiException(
        'FILE_LIMIT_REACHED',
        'The owner has reached the active limit for this media type',
        HttpStatus.CONFLICT,
      );
    }
    return this.toMetadata(await this.findFile(file.id));
  }

  private async deleteFile(
    fileId: string,
  ): Promise<FileMetadataDto> {
    const claimed = await this.withTransactionRetry(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id"
          FROM "media"."file_meta"
          WHERE "id" = ${fileId}::uuid
          FOR UPDATE`,
      );
      const current = await tx.fileMeta.findUnique({
        where: { id: fileId },
      });
      if (!current) {
        throw this.notFound();
      }
      if (current.status === FileStatus.DELETED) {
        return current;
      }
      const resumingDelete =
        current.status === FileStatus.DELETE_PENDING;
      const leaseIsFresh =
        current.updatedAt.getTime() >
        this.clock().getTime() - OPERATION_LEASE_MS;
      if (
        (resumingDelete && leaseIsFresh) ||
        (!resumingDelete && !DELETABLE_STATUSES.has(current.status))
      ) {
        throw new ApiException(
          'FILE_DELETE_IN_PROGRESS',
          'The file has an active deletion lease or cannot be deleted',
          HttpStatus.CONFLICT,
          { status: current.status },
        );
      }

      const references = await tx.fileReference.count({
        where: { fileId },
      });
      if (references > 0) {
        throw new ApiException(
          'FILE_IN_USE',
          'The file is referenced by another service',
          HttpStatus.CONFLICT,
          { references },
        );
      }

      return tx.fileMeta.update({
        where: { id: fileId },
        data: {
          status: FileStatus.DELETE_PENDING,
          confirmationRetryAt: null,
          lastErrorCode: null,
          aggregateVersion: { increment: 1 },
        },
      });
    });

    if (claimed.status === FileStatus.DELETED) {
      return this.toMetadata(claimed);
    }

    try {
      await this.storage.deleteAsset(this.toLocator(claimed));
      await this.storage.deleteIntentAssets(claimed.id);
    } catch (error) {
      const failed = await this.prisma.fileMeta.updateMany({
        where: {
          id: claimed.id,
          status: FileStatus.DELETE_PENDING,
          aggregateVersion: claimed.aggregateVersion,
        },
        data: {
          status: FileStatus.DELETE_FAILED,
          lastErrorCode: 'STORAGE_DELETE_FAILED',
          aggregateVersion: { increment: 1 },
        },
      });
      if (failed.count !== 1) {
        return this.resolveDeleteFenceLoss(fileId);
      }
      throw this.storageUnavailable(error);
    }

    const deleted = await this.prisma.fileMeta.updateMany({
      where: {
        id: claimed.id,
        status: FileStatus.DELETE_PENDING,
        aggregateVersion: claimed.aggregateVersion,
      },
      data: {
        status: FileStatus.DELETED,
        deletedAt: this.clock(),
        lastErrorCode: null,
        aggregateVersion: { increment: 1 },
      },
    });
    if (deleted.count !== 1) {
      return this.resolveDeleteFenceLoss(fileId);
    }
    return this.toMetadata(await this.findFile(fileId));
  }

  private async createDownloadUrl(
    file: FileMeta,
  ): Promise<DownloadUrlDto> {
    if (
      file.status !== FileStatus.ACTIVE ||
      !file.canonicalUrl
    ) {
      throw new ApiException(
        'FILE_NOT_ACTIVE',
        'Only an active file can be downloaded',
        HttpStatus.CONFLICT,
      );
    }
    const privateDelivery =
      file.storageDeliveryType ===
      StorageDeliveryType.AUTHENTICATED;
    const expiresAt = privateDelivery
      ? new Date(this.clock().getTime() + DOWNLOAD_TTL_MS)
      : null;
    try {
      return {
        url: this.storage.createDownloadUrl(
          this.toLocator(file),
          file.originalFilename,
          expiresAt ?? this.clock(),
          file.canonicalUrl,
        ),
        expiresAt: expiresAt?.toISOString() ?? null,
      };
    } catch (error) {
      throw this.storageUnavailable(error);
    }
  }

  private assertInspectedAsset(
    file: FileMeta,
    asset: InspectedAsset,
  ): void {
    const policy = getMediaPolicy(file.mediaType);
    const uploadCreatedAt = asset.createdAt.getTime();
    if (
      asset.publicId !== file.publicId ||
      asset.resourceType !== file.storageResourceType ||
      asset.deliveryType !== file.storageDeliveryType ||
      asset.format !== file.expectedFormat ||
      asset.contextFileId !== file.id ||
      uploadCreatedAt < file.createdAt.getTime() - 5000 ||
      uploadCreatedAt > file.intentExpiresAt.getTime()
    ) {
      throw new ApiException(
        'FILE_UPLOAD_MISMATCH',
        'The provider asset identity does not match the upload intent',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (
      asset.bytes <= 0 ||
      asset.bytes > policy.maxBytes
    ) {
      throw new ApiException(
        'FILE_TOO_LARGE',
        'The uploaded file exceeds the allowed size',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { maxBytes: policy.maxBytes },
      );
    }

    if (
      policy.resourceType === StorageResourceType.IMAGE &&
      (!asset.width ||
        !asset.height ||
        asset.width * asset.height > MAX_IMAGE_PIXELS)
    ) {
      throw new ApiException(
        'FILE_DIMENSIONS_INVALID',
        'The image dimensions are invalid or exceed the pixel limit',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { maxPixels: MAX_IMAGE_PIXELS },
      );
    }

    if (
      policy.resourceType === StorageResourceType.VIDEO &&
      (!asset.durationSeconds || asset.durationSeconds <= 0)
    ) {
      throw new ApiException(
        'FILE_DURATION_INVALID',
        'The video duration is missing or invalid',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (
      policy.resourceType === StorageResourceType.RAW &&
      (!asset.sample ||
        !matchesMagicBytes(asset.format, asset.sample))
    ) {
      throw new ApiException(
        'FILE_CONTENT_MISMATCH',
        'The file content does not match its declared format',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private assertPublicOwner(
    file: FileMeta,
    user: AuthUser,
  ): void {
    if (
      file.ownerType !== FileOwnerType.USER ||
      file.ownerId !== user.id
    ) {
      throw this.notFound();
    }
  }

  private assertExpectation(
    file: FileMeta,
    expected: InternalFileExpectationDto,
  ): void {
    if (
      file.ownerType !== expected.expectedOwnerType ||
      file.ownerId !== expected.expectedOwnerId ||
      file.mediaType !== expected.expectedType
    ) {
      throw new ApiException(
        'FILE_EXPECTATION_MISMATCH',
        'The file does not match the expected owner and type',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async findFile(fileId: string): Promise<FileMeta> {
    const file = await this.prisma.fileMeta.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw this.notFound();
    }
    return file;
  }

  private toMetadata(file: FileMeta): FileMetadataDto {
    const privateDelivery =
      file.storageDeliveryType ===
      StorageDeliveryType.AUTHENTICATED;
    return {
      id: file.id,
      ownerType: file.ownerType,
      ownerId: file.ownerId,
      type: file.mediaType,
      status: file.status,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      format: file.format,
      bytes: file.bytes,
      url:
        file.status === FileStatus.ACTIVE &&
        !privateDelivery
          ? file.canonicalUrl
          : null,
      privateDelivery,
      aggregateVersion: file.aggregateVersion,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    };
  }

  private toLocator(file: FileMeta): AssetLocator {
    return {
      publicId: file.publicId,
      resourceType: file.storageResourceType,
      deliveryType: file.storageDeliveryType,
      expectedFormat: file.expectedFormat,
      contextFileId: file.id,
    };
  }

  private normalizeIdempotencyKey(
    value: string | string[] | undefined,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (
      typeof value !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)
    ) {
      throw new ApiException(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must contain 8 to 128 safe characters',
        HttpStatus.BAD_REQUEST,
      );
    }
    return value;
  }

  private async restorePending(
    file: FileMeta,
    code: string,
    now: Date,
  ): Promise<boolean> {
    const exponent = Math.min(
      Math.max(file.confirmationAttempts - 1, 0),
      10,
    );
    const retryDelay = Math.min(
      CONFIRM_RETRY_BASE_MS * 2 ** exponent,
      CONFIRM_RETRY_MAX_MS,
    );
    const restored = await this.prisma.fileMeta.updateMany({
      where: {
        id: file.id,
        status: FileStatus.VERIFYING,
        aggregateVersion: file.aggregateVersion,
      },
      data: {
        status: FileStatus.PENDING,
        confirmationRetryAt: new Date(now.getTime() + retryDelay),
        lastErrorCode: code,
        aggregateVersion: { increment: 1 },
      },
    });
    return restored.count === 1;
  }

  private async rejectFile(
    file: FileMeta,
    code: string,
  ): Promise<boolean> {
    const rejected = await this.prisma.fileMeta.updateMany({
      where: {
        id: file.id,
        status: FileStatus.VERIFYING,
        aggregateVersion: file.aggregateVersion,
      },
      data: {
        status: FileStatus.REJECTED,
        confirmationRetryAt: null,
        lastErrorCode: code,
        aggregateVersion: { increment: 1 },
      },
    });
    return rejected.count === 1;
  }

  private async resolveConfirmationFenceLoss(
    fileId: string,
  ): Promise<FileMetadataDto> {
    const current = await this.findFile(fileId);
    if (current.status === FileStatus.ACTIVE) {
      return this.toMetadata(current);
    }
    if (current.status === FileStatus.EXPIRED) {
      throw new ApiException(
        'FILE_INTENT_EXPIRED',
        'The upload intent has expired',
        HttpStatus.GONE,
      );
    }
    throw new ApiException(
      'FILE_CONFIRMATION_IN_PROGRESS',
      'The file state changed while confirmation was running',
      HttpStatus.CONFLICT,
      {
        status: current.status,
        aggregateVersion: current.aggregateVersion,
      },
    );
  }

  private async resolveDeleteFenceLoss(
    fileId: string,
  ): Promise<FileMetadataDto> {
    const current = await this.findFile(fileId);
    if (current.status === FileStatus.DELETED) {
      return this.toMetadata(current);
    }
    throw new ApiException(
      'FILE_DELETE_IN_PROGRESS',
      'The file state changed while deletion was running',
      HttpStatus.CONFLICT,
      {
        status: current.status,
        aggregateVersion: current.aggregateVersion,
      },
    );
  }

  private storageUnavailable(error: unknown): ApiException {
    return new ApiException(
      'STORAGE_UNAVAILABLE',
      'Media storage is temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
      error instanceof StorageUnavailableError
        ? null
        : { operation: 'storage' },
    );
  }

  private apiCode(exception: ApiException): string {
    const response = exception.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof response.code === 'string'
    ) {
      return response.code;
    }
    return 'FILE_UPLOAD_MISMATCH';
  }

  private notFound(): ApiException {
    return new ApiException(
      'FILE_NOT_FOUND',
      'The file was not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    ) {
      return true;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2010'
    ) {
      const code = String(error.meta?.code ?? '');
      return code === '40001' || code === '40P01';
    }
    const message =
      error instanceof Error ? error.message : String(error);
    return (
      message.includes('could not serialize access') ||
      message.includes('deadlock detected')
    );
  }

  private async withTransactionRetry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (
      let attempt = 1;
      attempt <= MAX_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        });
      } catch (error) {
        if (
          !this.isRetryableTransactionError(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
        const backoff =
          Math.min(25 * 2 ** (attempt - 1), 250) +
          Math.floor(Math.random() * 25);
        await new Promise((resolve) =>
          setTimeout(resolve, backoff),
        );
      }
    }
    throw new Error('Transaction retry loop exhausted');
  }
}
