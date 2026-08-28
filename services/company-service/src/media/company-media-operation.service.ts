import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompanyMediaAssetType as PrismaCompanyMediaAssetType,
  CompanyMediaOperation,
  CompanyMediaOperationKind,
  CompanyMediaType as LocalCompanyMediaType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CompanyMediaAssetType,
  CompanyMediaClient,
} from './company-media.client';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MS = 45_000;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1000;
const DEFAULT_MEDIA_REQUEST_TIMEOUT_MS = 3_000;
const DEFAULT_ATTACH_GRACE_MS = 30_000;
const DEFAULT_UPLOAD_INTENT_GRACE_MS = 15 * 60 * 1000;
const LOGO_REFERENCE_TYPE = 'COMPANY_LOGO';
const MEDIA_REFERENCE_TYPE = 'COMPANY_MEDIA';
const UPLOAD_INTENT_REFERENCE_TYPE = 'COMPANY_UPLOAD_INTENT';

interface OperationOptions {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  leaseMs: number;
  attachGraceMs: number;
  uploadIntentGraceMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

@Injectable()
export class CompanyMediaOperationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CompanyMediaOperationService.name);
  private readonly options: OperationOptions;
  private interval: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private cycleRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: CompanyMediaClient,
    config: ConfigService,
  ) {
    this.options = this.readOptions(config);
  }

  onApplicationBootstrap(): void {
    if (!this.options.enabled) return;
    this.interval = setInterval(() => this.kick(), this.options.intervalMs);
    this.interval.unref();
    this.kick();
  }

  onApplicationShutdown(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.kickTimer) {
      clearTimeout(this.kickTimer);
      this.kickTimer = null;
    }
  }

  /** Schedules a near-term reconciliation cycle without overlapping this instance. */
  kick(): void {
    if (!this.options.enabled || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.runScheduledCycle();
    }, 0);
    this.kickTimer.unref();
  }

  /** Processes at most one configured batch. Safe to invoke from tests/ops tooling. */
  async processDueOnce(): Promise<void> {
    for (let index = 0; index < this.options.batchSize; index += 1) {
      const operation = await this.claimNext();
      if (!operation) return;
      await this.process(operation);
    }
  }

  /** Expiry used by a foreground request; the request renews the whole batch. */
  foregroundLeaseExpiresAt(): Date {
    return new Date(Date.now() + this.options.leaseMs);
  }

  uploadIntentCleanupAt(expiresAt: Date): Date {
    return new Date(expiresAt.getTime() + this.options.uploadIntentGraceMs);
  }

  private async runScheduledCycle(): Promise<void> {
    if (this.cycleRunning) return;
    this.cycleRunning = true;
    try {
      await this.processDueOnce();
    } catch {
      this.logger.error('Company media reconciliation cycle failed');
    } finally {
      this.cycleRunning = false;
    }
  }

  private async claimNext(): Promise<CompanyMediaOperation | null> {
    // A loser of the compare-and-set simply searches again. Limiting contention
    // retries prevents a busy fleet from spinning on the same small queue.
    for (let contention = 0; contention < 3; contention += 1) {
      const now = new Date();
      const attachCreatedBefore = new Date(
        now.getTime() - this.options.attachGraceMs,
      );
      const candidate = await this.prisma.companyMediaOperation.findFirst({
        where: {
          AND: [
            { nextAttemptAt: { lte: now } },
            {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: now } },
              ],
            },
            {
              OR: [
                { kind: CompanyMediaOperationKind.DETACH_CLEANUP },
                { kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP },
                {
                  kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
                  createdAt: { lte: attachCreatedBefore },
                },
              ],
            },
          ],
        },
        orderBy: [
          { nextAttemptAt: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      });
      if (!candidate) return null;

      const leaseToken = randomUUID();
      const claimed = await this.prisma.companyMediaOperation.updateMany({
        where: {
          id: candidate.id,
          AND: [
            { nextAttemptAt: { lte: now } },
            {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: now } },
              ],
            },
            {
              OR: [
                { kind: CompanyMediaOperationKind.DETACH_CLEANUP },
                { kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP },
                {
                  kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
                  createdAt: { lte: attachCreatedBefore },
                },
              ],
            },
          ],
        },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + this.options.leaseMs),
          attemptCount: { increment: 1 },
          lastErrorCode: null,
        },
      });
      if (claimed.count !== 1) continue;

      return this.prisma.companyMediaOperation.findFirst({
        where: { id: candidate.id, leaseToken },
      });
    }
    return null;
  }

  private async process(operation: CompanyMediaOperation): Promise<void> {
    try {
      let current = operation;
      if (
        current.kind === CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP
      ) {
        await this.processUploadIntentCleanup(current);
        return;
      }
      if (
        current.kind ===
          CompanyMediaOperationKind.ATTACH_COMPENSATION &&
        current.mediaReferenceId === null
      ) {
        try {
          const recovered = await this.recoverCompensationReference(current);
          if (!recovered) return;
          current = recovered;
        } catch (error) {
          const status = this.httpStatus(error);
          if (status === 404 || status === 422) {
            // The file never became a valid owned asset (or is already gone).
            // Do not issue a blind delete when no reference UUID is known.
            await this.complete(current);
            return;
          }
          throw error;
        }
      }

      // This also protects a stale DETACH job when the same stable slot was
      // reattached before the worker acquired it.
      if (await this.isExactLocalAttachment(current)) {
        await this.complete(current);
        return;
      }

      if (current.mediaReferenceId) {
        try {
          await this.media.releaseReference(current.mediaReferenceId);
        } catch (error) {
          if (this.httpStatus(error) !== 404) throw error;
        }
      }

      if (!(await this.isFileLocallyAttached(current.fileId))) {
        try {
          await this.media.deleteCompanyFile(
            current.fileId,
            current.companyId,
            this.toClientAssetType(current.assetType),
          );
        } catch (error) {
          // Missing files and ownership/type mismatches are terminal-safe only
          // after our reference has been released. 409/503 remain retryable.
          const status = this.httpStatus(error);
          if (status !== 404 && status !== 422) throw error;
        }
      }

      await this.complete(current);
    } catch (error) {
      await this.retry(operation, this.errorCode(error));
    }
  }

  private async processUploadIntentCleanup(
    operation: CompanyMediaOperation,
  ): Promise<void> {
    if (
      operation.referenceType !== UPLOAD_INTENT_REFERENCE_TYPE ||
      operation.referenceId !== operation.fileId ||
      operation.localMediaId !== null ||
      operation.mediaReferenceId !== null
    ) {
      throw new Error('Invalid Company media upload-intent cleanup operation');
    }

    if (!(await this.isFileLocallyAttached(operation.fileId))) {
      try {
        await this.media.deleteCompanyFile(
          operation.fileId,
          operation.companyId,
          this.toClientAssetType(operation.assetType),
        );
      } catch (error) {
        const status = this.httpStatus(error);
        if (status !== 404 && status !== 422) throw error;
      }
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.companyMediaUploadIntent.deleteMany({
        where: {
          fileId: operation.fileId,
          companyId: operation.companyId,
          assetType: operation.assetType,
        },
      });
      const completed = await transaction.companyMediaOperation.deleteMany({
        where: {
          id: operation.id,
          kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP,
          leaseToken: operation.leaseToken,
        },
      });
      if (completed.count !== 1) {
        throw new Error('Company media upload-intent cleanup lease was lost');
      }
    });
  }

  private async recoverCompensationReference(
    operation: CompanyMediaOperation,
  ): Promise<CompanyMediaOperation | null> {
    const assetType = this.toClientAssetType(operation.assetType);
    await this.media.verifyCompanyFile(
      operation.fileId,
      operation.companyId,
      assetType,
    );
    const reference = await this.media.bindCompanyFile(
      operation.fileId,
      operation.companyId,
      assetType,
      operation.referenceType,
      operation.referenceId,
    );
    const persisted = await this.prisma.companyMediaOperation.updateMany({
      where: {
        id: operation.id,
        leaseToken: operation.leaseToken,
        mediaReferenceId: null,
      },
      data: { mediaReferenceId: reference.id },
    });
    if (persisted.count !== 1) return null;
    return { ...operation, mediaReferenceId: reference.id };
  }

  private async isExactLocalAttachment(
    operation: CompanyMediaOperation,
  ): Promise<boolean> {
    if (!operation.mediaReferenceId) return false;

    if (
      operation.assetType === PrismaCompanyMediaAssetType.COMPANY_LOGO
    ) {
      if (
        operation.referenceType !== LOGO_REFERENCE_TYPE ||
        operation.localMediaId !== null
      ) {
        return false;
      }
      const company = await this.prisma.company.findFirst({
        where: {
          id: operation.companyId,
          logoFileId: operation.fileId,
          logoMediaReferenceId: operation.mediaReferenceId,
        },
        select: { id: true },
      });
      return company !== null;
    }

    if (
      operation.referenceType !== MEDIA_REFERENCE_TYPE ||
      operation.localMediaId === null ||
      operation.referenceId !== operation.localMediaId
    ) {
      return false;
    }
    const expectedLocalType =
      operation.assetType === PrismaCompanyMediaAssetType.COMPANY_IMAGE
        ? LocalCompanyMediaType.IMAGE
        : LocalCompanyMediaType.VIDEO;
    const media = await this.prisma.companyMedia.findFirst({
      where: {
        id: operation.localMediaId,
        companyId: operation.companyId,
        fileId: operation.fileId,
        mediaReferenceId: operation.mediaReferenceId,
        type: expectedLocalType,
      },
      select: { id: true },
    });
    return media !== null;
  }

  private async isFileLocallyAttached(fileId: string): Promise<boolean> {
    const [logo, galleryMedia] = await Promise.all([
      this.prisma.company.findFirst({
        where: { logoFileId: fileId },
        select: { id: true },
      }),
      this.prisma.companyMedia.findFirst({
        where: { fileId },
        select: { id: true },
      }),
    ]);
    return Boolean(logo || galleryMedia);
  }

  private async complete(operation: CompanyMediaOperation): Promise<void> {
    await this.prisma.companyMediaOperation.deleteMany({
      where: { id: operation.id, leaseToken: operation.leaseToken },
    });
  }

  private async retry(
    operation: CompanyMediaOperation,
    errorCode: string,
  ): Promise<void> {
    const exponent = Math.min(Math.max(operation.attemptCount - 1, 0), 30);
    const delay = Math.min(
      this.options.retryBaseMs * 2 ** exponent,
      this.options.retryMaxMs,
    );
    await this.prisma.companyMediaOperation.updateMany({
      where: { id: operation.id, leaseToken: operation.leaseToken },
      data: {
        nextAttemptAt: new Date(Date.now() + delay),
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
      },
    });
    this.logger.warn(
      `Company media operation scheduled for retry (${errorCode})`,
    );
  }

  private toClientAssetType(
    assetType: PrismaCompanyMediaAssetType,
  ): CompanyMediaAssetType {
    switch (assetType) {
      case PrismaCompanyMediaAssetType.COMPANY_LOGO:
        return CompanyMediaAssetType.COMPANY_LOGO;
      case PrismaCompanyMediaAssetType.COMPANY_IMAGE:
        return CompanyMediaAssetType.COMPANY_IMAGE;
      case PrismaCompanyMediaAssetType.COMPANY_VIDEO:
        return CompanyMediaAssetType.COMPANY_VIDEO;
    }
  }

  private httpStatus(error: unknown): number | null {
    if (
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      typeof error.getStatus === 'function'
    ) {
      const status = error.getStatus();
      return typeof status === 'number' ? status : null;
    }
    return null;
  }

  private errorCode(error: unknown): string {
    let code: unknown;
    if (
      typeof error === 'object' &&
      error !== null &&
      'getResponse' in error &&
      typeof error.getResponse === 'function'
    ) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        code = response.code;
      }
    }
    if (typeof code !== 'string' && error instanceof Error) {
      code = error.name;
    }
    const rawCode =
      typeof code === 'string'
        ? code
        : 'COMPANY_MEDIA_OPERATION_FAILED';
    const safe = rawCode
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 64);
    return safe || 'COMPANY_MEDIA_OPERATION_FAILED';
  }

  private readOptions(config: ConfigService): OperationOptions {
    const intervalMs =
      this.readInteger(
        config,
        'COMPANY_MEDIA_OPERATION_INTERVAL_SECONDS',
        1,
        3600,
        DEFAULT_INTERVAL_MS / 1000,
      ) * 1000;
    const batchSize = this.readInteger(
      config,
      'COMPANY_MEDIA_OPERATION_BATCH_SIZE',
      1,
      100,
      DEFAULT_BATCH_SIZE,
    );
    const leaseMs =
      this.readInteger(
        config,
        'COMPANY_MEDIA_OPERATION_LEASE_SECONDS',
        10,
        1800,
        DEFAULT_LEASE_MS / 1000,
      ) * 1000;
    const retryBaseMs =
      this.readInteger(
        config,
        'COMPANY_MEDIA_OPERATION_RETRY_BASE_SECONDS',
        1,
        3600,
        DEFAULT_RETRY_BASE_MS / 1000,
      ) * 1000;
    const attachGraceMs =
      this.readInteger(
        config,
        'COMPANY_MEDIA_OPERATION_ATTACH_GRACE_SECONDS',
        1,
        600,
        DEFAULT_ATTACH_GRACE_MS / 1000,
      ) * 1000;
    const uploadIntentGraceMs =
      this.readInteger(
        config,
        'COMPANY_MEDIA_UPLOAD_INTENT_GRACE_SECONDS',
        0,
        86400,
        DEFAULT_UPLOAD_INTENT_GRACE_MS / 1000,
      ) * 1000;
    const retryMaxMs =
      this.readInteger(
        config,
        'COMPANY_MEDIA_OPERATION_RETRY_MAX_SECONDS',
        1,
        86400,
        DEFAULT_RETRY_MAX_MS / 1000,
      ) * 1000;
    const mediaRequestTimeoutMs = this.readInteger(
      config,
      'MEDIA_REQUEST_TIMEOUT_MS',
      100,
      10_000,
      DEFAULT_MEDIA_REQUEST_TIMEOUT_MS,
    );
    if (
      retryMaxMs < retryBaseMs ||
      leaseMs < 4 * mediaRequestTimeoutMs + 5_000
    ) {
      throw new Error('Company media operation configuration is invalid');
    }
    return {
      enabled: this.readBoolean(
        config,
        'COMPANY_MEDIA_OPERATION_ENABLED',
        true,
      ),
      intervalMs,
      batchSize,
      leaseMs,
      attachGraceMs,
      uploadIntentGraceMs,
      retryBaseMs,
      retryMaxMs,
    };
  }

  private readBoolean(
    config: ConfigService,
    name: string,
    fallback: boolean,
  ): boolean {
    const value = config.get<unknown>(name);
    if (value === undefined || value === '') return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be true or false`);
  }

  private readInteger(
    config: ConfigService,
    name: string,
    minimum: number,
    maximum: number,
    fallback: number,
  ): number {
    const value = config.get<unknown>(name);
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new Error(`${name} must be an integer`);
    }
    const parsed = Number(value);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < minimum ||
      parsed > maximum
    ) {
      throw new Error(`${name} is outside its allowed range`);
    }
    return parsed;
  }
}
