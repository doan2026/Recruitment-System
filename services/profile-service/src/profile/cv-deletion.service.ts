import {
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Cv,
  CvDeletionState,
  CvEventAction,
  CvMediaCleanupStatus,
  CvType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  ApplicationCvDeletionFence,
  ApplicationCvUsageClient,
} from '../application/application-cv-usage.client';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { DeletedCvResponseDto } from './dto/profile-media-response.dto';
import { CvMediaCleanupService } from './cv-media-cleanup.service';
import { CvEventPublisherService } from './cv-event-publisher.service';
import { ProfileService } from './profile.service';

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const DEFAULT_RECONCILE_BATCH_SIZE = 10;
const DEFAULT_FENCE_LEASE_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1000;

type Transaction = Prisma.TransactionClient;
type WorkflowWithCleanup =
  Prisma.CvDeletionWorkflowGetPayload<{
    include: { cleanup: true };
  }>;

type BeginDeletion =
  | { kind: 'LEGACY_SOFT'; cv: Cv }
  | { kind: 'WORKFLOW'; workflow: WorkflowWithCleanup };

interface ReconcileOptions {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  leaseMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

@Injectable()
export class CvDeletionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CvDeletionService.name);
  private readonly workerId = randomUUID();
  private readonly options: ReconcileOptions;
  private timer: NodeJS.Timeout | null = null;
  private cycleRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly application: ApplicationCvUsageClient,
    private readonly cleanup: CvMediaCleanupService,
    private readonly events: CvEventPublisherService,
    config: ConfigService,
  ) {
    this.options = this.readOptions(config);
  }

  onApplicationBootstrap(): void {
    if (!this.options.enabled) return;
    this.timer = setInterval(() => {
      void this.runScheduledCycle();
    }, this.options.intervalMs);
    this.timer.unref();
    void this.runScheduledCycle();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async deleteCv(
    userIdInput: string,
    cvIdInput: string,
    expectedAggregateVersion: number,
  ): Promise<DeletedCvResponseDto> {
    const userId = userIdInput.toLowerCase();
    const cvId = cvIdInput.toLowerCase();
    const deletionRequestId = randomUUID();

    const begun = await this.profiles.runMutation(
      async (transaction): Promise<BeginDeletion> => {
        const profileId = await this.lockExistingProfile(
          transaction,
          userId,
        );
        const existingWorkflow =
          await transaction.cvDeletionWorkflow.findFirst({
            where: { cvId, userId },
            include: { cleanup: true },
          });
        if (existingWorkflow) {
          this.assertWorkflowVersion(
            existingWorkflow,
            expectedAggregateVersion,
          );
          return {
            kind: 'WORKFLOW',
            workflow: existingWorkflow,
          };
        }

        const current = await this.findLifecycleCv(
          transaction,
          userId,
          cvId,
        );
        if (current.isDeleted) {
          return { kind: 'LEGACY_SOFT', cv: current };
        }
        this.assertExpectedCvVersion(
          current,
          expectedAggregateVersion,
        );

        const replacement = current.isDefault
          ? await transaction.cv.findFirst({
              where: {
                userId,
                isDeleted: false,
                id: { not: current.id },
              },
              orderBy: [
                { createdAt: 'desc' },
                { id: 'asc' },
              ],
            })
          : null;
        const deletedAt = new Date();
        const deleted = await transaction.cv.update({
          where: { id: current.id },
          data: {
            isDefault: false,
            isDeleted: true,
            deletedAt,
            aggregateVersion: { increment: 1 },
          },
        });
        if (replacement) {
          await transaction.cv.update({
            where: { id: replacement.id },
            data: {
              isDefault: true,
              aggregateVersion: { increment: 1 },
            },
          });
        }
        await transaction.$queryRaw(
          Prisma.sql`SELECT set_config(
            'profile.cv_deletion_request_id',
            ${deletionRequestId},
            true
          )`,
        );
        const workflow =
          await transaction.cvDeletionWorkflow.create({
            data: {
              cvId: deleted.id,
              userId,
              deletionRequestId,
              expectedAggregateVersion,
              resultAggregateVersion: deleted.aggregateVersion,
              fileId: deleted.fileId,
              mediaReferenceId: deleted.mediaReferenceId!,
              replacementDefaultCvId: replacement?.id ?? null,
              cvCreatedAt: deleted.createdAt,
              deletedAt: deleted.deletedAt!,
            },
            include: { cleanup: true },
          });
        await transaction.profile.update({
          where: { id: profileId },
          data: { aggregateVersion: { increment: 1 } },
        });
        await this.assertCvDefaultInvariant(transaction);
        return { kind: 'WORKFLOW', workflow };
      },
    );

    if (begun.kind === 'LEGACY_SOFT') {
      return this.toLegacySoftResponse(begun.cv);
    }
    return this.continueDeletion(begun.workflow);
  }

  async runOnce(): Promise<number> {
    let processed = 0;
    for (
      let index = 0;
      index < this.options.batchSize;
      index += 1
    ) {
      const cvId = await this.claimPendingWorkflow(null);
      if (!cvId) break;
      await this.reconcileClaimedWorkflow(cvId);
      processed += 1;
    }
    return processed;
  }

  private async continueDeletion(
    snapshot: WorkflowWithCleanup,
  ): Promise<DeletedCvResponseDto> {
    if (snapshot.state !== CvDeletionState.PENDING_FENCE) {
      return this.responseForPersistedWorkflow(snapshot);
    }
    const claimedCvId = await this.claimPendingWorkflow(snapshot.cvId);
    if (!claimedCvId) {
      return this.reloadWorkflowResponse(snapshot.cvId);
    }
    const claimed = await this.prisma.cvDeletionWorkflow.findUnique({
      where: { cvId: claimedCvId },
      include: { cleanup: true },
    });
    if (!claimed) throw this.invalidDeletionState();
    if (claimed.state !== CvDeletionState.PENDING_FENCE) {
      return this.responseForPersistedWorkflow(claimed);
    }
    try {
      return await this.resume(claimed);
    } catch (error) {
      const errorCode = this.errorCode(error);
      await this.deferFenceRetry(claimed, errorCode);
      this.logger.warn(
        `CV deletion remains pending cvId=${claimed.cvId} deletionRequestId=${claimed.deletionRequestId} code=${errorCode}`,
      );
      return this.reloadWorkflowResponse(claimed.cvId);
    }
  }

  private async reloadWorkflowResponse(
    cvId: string,
  ): Promise<DeletedCvResponseDto> {
    const workflow = await this.prisma.cvDeletionWorkflow.findUnique({
      where: { cvId },
      include: { cleanup: true },
    });
    if (!workflow) throw this.invalidDeletionState();
    return this.responseForPersistedWorkflow(workflow);
  }

  private responseForPersistedWorkflow(
    workflow: WorkflowWithCleanup,
  ): Promise<DeletedCvResponseDto> | DeletedCvResponseDto {
    if (workflow.state === CvDeletionState.PENDING_FENCE) {
      return this.toPendingResponse(workflow);
    }
    if (workflow.state === CvDeletionState.SOFT_RETAINED) {
      return this.toWorkflowResponse(workflow);
    }
    if (workflow.state === CvDeletionState.HARD_DELETED) {
      return this.cleanupAndRespond(workflow);
    }
    throw this.invalidDeletionState();
  }

  private async resume(
    workflow: WorkflowWithCleanup,
  ): Promise<DeletedCvResponseDto> {
    if (workflow.state === CvDeletionState.SOFT_RETAINED) {
      return this.toWorkflowResponse(workflow);
    }
    if (workflow.state === CvDeletionState.HARD_DELETED) {
      return this.cleanupAndRespond(workflow);
    }
    if (
      workflow.state === CvDeletionState.HARD_DELETE_AUTHORIZED
    ) {
      throw this.invalidDeletionState();
    }

    const decision = await this.application.acquireDeletionFence(
      workflow.userId,
      workflow.cvId,
      workflow.deletionRequestId,
    );
    if (decision.disposition === 'USED') {
      return this.finalizeUsed(workflow, decision);
    }
    return this.finalizeHard(workflow, decision);
  }

  private async finalizeUsed(
    snapshot: WorkflowWithCleanup,
    decision: ApplicationCvDeletionFence,
  ): Promise<DeletedCvResponseDto> {
    const firstUsedAt = this.validateUsedDecision(snapshot, decision);
    const result = await this.profiles.runMutation(
      async (transaction) => {
        await this.lockExistingProfile(
          transaction,
          snapshot.userId,
        );
        const current =
          await transaction.cvDeletionWorkflow.findUniqueOrThrow({
            where: { cvId: snapshot.cvId },
            include: { cleanup: true },
          });
        if (current.state === CvDeletionState.SOFT_RETAINED) {
          this.assertSameUsedDecision(
            current,
            firstUsedAt,
          );
          return { workflow: current, eventAppended: false };
        }
        if (current.state !== CvDeletionState.PENDING_FENCE) {
          throw this.invalidDeletionState();
        }

        const cv = await transaction.cv.findFirst({
          where: {
            id: current.cvId,
            userId: current.userId,
            isDeleted: true,
            fileId: current.fileId,
            mediaReferenceId: current.mediaReferenceId,
          },
        });
        if (
          !cv ||
          cv.aggregateVersion !==
            current.resultAggregateVersion ||
          (cv.firstUsedAt !== null &&
            cv.firstUsedAt.getTime() !== firstUsedAt.getTime())
        ) {
          throw this.invalidDeletionState();
        }
        const retainedCv = cv.firstUsedAt === null
          ? await transaction.cv.update({
            where: { id: cv.id },
            data: { firstUsedAt },
          })
          : cv;
        await this.events.append(
          transaction,
          retainedCv,
          CvEventAction.DEACTIVATED,
        );
        const workflow = await transaction.cvDeletionWorkflow.update({
          where: { cvId: current.cvId },
          data: {
            state: CvDeletionState.SOFT_RETAINED,
            firstUsedAt,
            applicationCount: BigInt(decision.applicationCount),
            fenceLeaseOwner: null,
            fenceLeaseUntil: null,
            lastFenceErrorCode: null,
          },
          include: { cleanup: true },
        });
        return { workflow, eventAppended: true };
      },
    );
    if (result.eventAppended) this.events.wake();
    return this.toWorkflowResponse(result.workflow);
  }

  private async finalizeHard(
    snapshot: WorkflowWithCleanup,
    decision: ApplicationCvDeletionFence,
  ): Promise<DeletedCvResponseDto> {
    const fencedAt = this.validateFencedDecision(snapshot, decision);
    const cleanupJobId = randomUUID();
    const result = await this.profiles.runMutation(
      async (transaction) => {
        await this.lockExistingProfile(
          transaction,
          snapshot.userId,
        );
        const current =
          await transaction.cvDeletionWorkflow.findUniqueOrThrow({
            where: { cvId: snapshot.cvId },
            include: { cleanup: true },
          });
        if (current.state === CvDeletionState.HARD_DELETED) {
          return { workflow: current, eventAppended: false };
        }
        if (current.state !== CvDeletionState.PENDING_FENCE) {
          throw this.invalidDeletionState();
        }

        const cv = await transaction.cv.findFirst({
          where: {
            id: current.cvId,
            userId: current.userId,
            isDeleted: true,
            isDefault: false,
            fileId: current.fileId,
            mediaReferenceId: current.mediaReferenceId,
          },
        });
        if (
          !cv ||
          cv.firstUsedAt !== null ||
          cv.aggregateVersion !== current.resultAggregateVersion
        ) {
          throw this.invalidDeletionState();
        }
        const successors = await transaction.cv.count({
          where: {
            OR: [
              { previousRevisionId: cv.id },
              {
                revisionSeriesId: cv.id,
                id: { not: cv.id },
              },
            ],
          },
        });
        if (successors !== 0) {
          throw new ApiException(
            'CV_HARD_DELETE_UNSAFE',
            'A CV revision with retained successors cannot be hard-deleted',
            HttpStatus.CONFLICT,
          );
        }

        await transaction.$queryRaw(
          Prisma.sql`SELECT set_config(
            'profile.cv_deletion_request_id',
            ${current.deletionRequestId},
            true
          )`,
        );
        await transaction.cvDeletionWorkflow.update({
          where: { cvId: current.cvId },
          data: {
            state: CvDeletionState.HARD_DELETE_AUTHORIZED,
            fencedAt,
            fenceLeaseOwner: null,
            fenceLeaseUntil: null,
            lastFenceErrorCode: null,
          },
        });
        if (!current.cleanup) {
          await transaction.cvMediaCleanupJob.create({
            data: {
              id: cleanupJobId,
              cvId: current.cvId,
              userId: current.userId,
              fileId: current.fileId,
              mediaReferenceId: current.mediaReferenceId,
            },
          });
        }
        await this.events.append(
          transaction,
          cv,
          CvEventAction.DELETED,
        );
        await transaction.cv.delete({ where: { id: cv.id } });
        const completed =
          await transaction.cvDeletionWorkflow.update({
            where: { cvId: current.cvId },
            data: { state: CvDeletionState.HARD_DELETED },
            include: { cleanup: true },
          });
        await this.assertCvDefaultInvariant(transaction);
        return { workflow: completed, eventAppended: true };
      },
    );
    if (result.eventAppended) this.events.wake();
    return this.cleanupAndRespond(result.workflow);
  }

  private async cleanupAndRespond(
    workflow: WorkflowWithCleanup,
  ): Promise<DeletedCvResponseDto> {
    let completed =
      workflow.cleanup?.status ===
      CvMediaCleanupStatus.SUCCEEDED;
    if (!completed) {
      try {
        completed = await this.cleanup.tryCleanupCv(workflow.cvId);
      } catch (error) {
        this.logger.error(
          `Immediate CV Media cleanup failed for ${workflow.cvId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return this.toWorkflowResponse(workflow, !completed);
  }

  private async runScheduledCycle(): Promise<void> {
    if (this.cycleRunning) return;
    this.cycleRunning = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(
        'CV deletion fence reconciliation cycle failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.cycleRunning = false;
    }
  }

  private async claimPendingWorkflow(
    cvId: string | null,
  ): Promise<string | null> {
    const cvFilter =
      cvId === null
        ? Prisma.empty
        : Prisma.sql`AND "cv_id" = ${cvId}::uuid`;
    const rows = await this.prisma.$queryRaw<
      Array<{ cvId: string }>
    >(
      Prisma.sql`WITH candidate AS (
        SELECT "cv_id"
        FROM "profile"."cv_deletion_workflow"
        WHERE "state" = 'PENDING_FENCE'
          AND (
            (
              "fence_lease_owner" IS NULL
              AND "fence_next_attempt_at" <= clock_timestamp()
            )
            OR "fence_lease_until" <= clock_timestamp()
          )
          ${cvFilter}
        ORDER BY
          COALESCE("fence_lease_until", "fence_next_attempt_at"),
          "cv_id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "profile"."cv_deletion_workflow" AS workflow
      SET "fence_attempt_count" = workflow."fence_attempt_count" + 1,
          "fence_lease_owner" = ${this.workerId},
          "fence_lease_fence" = workflow."fence_lease_fence" + 1,
          "fence_lease_until" = clock_timestamp()
            + (${this.options.leaseMs} * INTERVAL '1 millisecond'),
          "last_fence_error_code" = NULL,
          "updated_at" = clock_timestamp()
      FROM candidate
      WHERE workflow."cv_id" = candidate."cv_id"
      RETURNING workflow."cv_id" AS "cvId"`,
    );
    return rows[0]?.cvId ?? null;
  }

  private async reconcileClaimedWorkflow(
    cvId: string,
  ): Promise<void> {
    const workflow =
      await this.prisma.cvDeletionWorkflow.findUnique({
        where: { cvId },
        include: { cleanup: true },
      });
    if (!workflow || workflow.state !== CvDeletionState.PENDING_FENCE) {
      return;
    }
    try {
      await this.resume(workflow);
    } catch (error) {
      await this.deferFenceRetry(workflow, this.errorCode(error));
    }
  }

  private async deferFenceRetry(
    workflow: WorkflowWithCleanup,
    errorCode: string,
  ): Promise<void> {
    const delay = Math.min(
      this.options.retryBaseMs *
        2 ** Math.max(workflow.fenceAttemptCount - 1, 0),
      this.options.retryMaxMs,
    );
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "profile"."cv_deletion_workflow"
        SET "fence_next_attempt_at" = clock_timestamp()
              + (${delay} * INTERVAL '1 millisecond'),
            "fence_lease_owner" = NULL,
            "fence_lease_until" = NULL,
            "last_fence_error_code" = ${errorCode},
            "updated_at" = clock_timestamp()
        WHERE "cv_id" = ${workflow.cvId}::uuid
          AND "state" = 'PENDING_FENCE'
          AND "fence_lease_owner" = ${this.workerId}
          AND "fence_lease_fence" = ${workflow.fenceLeaseFence}
          AND "fence_lease_until" > clock_timestamp()`,
    );
  }

  private validateUsedDecision(
    workflow: WorkflowWithCleanup,
    decision: ApplicationCvDeletionFence,
  ): Date {
    if (
      decision.candidateId !== workflow.userId ||
      decision.cvId !== workflow.cvId ||
      decision.deletionRequestId !== workflow.deletionRequestId ||
      decision.disposition !== 'USED' ||
      decision.fencedAt !== null ||
      decision.firstUsedAt === null ||
      decision.applicationCount < 1
    ) {
      throw this.invalidApplicationDecision();
    }
    const firstUsedAt = new Date(decision.firstUsedAt);
    if (
      Number.isNaN(firstUsedAt.getTime()) ||
      firstUsedAt.getTime() < workflow.cvCreatedAt.getTime()
    ) {
      throw this.invalidApplicationDecision();
    }
    return firstUsedAt;
  }

  private validateFencedDecision(
    workflow: WorkflowWithCleanup,
    decision: ApplicationCvDeletionFence,
  ): Date {
    if (
      decision.candidateId !== workflow.userId ||
      decision.cvId !== workflow.cvId ||
      decision.deletionRequestId !== workflow.deletionRequestId ||
      decision.disposition !== 'FENCED' ||
      decision.fencedAt === null ||
      decision.firstUsedAt !== null ||
      decision.applicationCount !== 0
    ) {
      throw this.invalidApplicationDecision();
    }
    const fencedAt = new Date(decision.fencedAt);
    if (Number.isNaN(fencedAt.getTime())) {
      throw this.invalidApplicationDecision();
    }
    return fencedAt;
  }

  private assertSameUsedDecision(
    workflow: WorkflowWithCleanup,
    firstUsedAt: Date,
  ): void {
    if (
      workflow.firstUsedAt?.getTime() !== firstUsedAt.getTime()
    ) {
      throw this.invalidApplicationDecision();
    }
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
    if (!rows[0]) throw this.cvNotFound();
    return rows[0].id;
  }

  private async findLifecycleCv(
    transaction: Transaction,
    userId: string,
    cvId: string,
  ): Promise<Cv> {
    const cv = await transaction.cv.findFirst({
      where: {
        id: cvId,
        userId,
        type: { in: [CvType.UPLOAD, CvType.ONLINE] },
        fileUrl: null,
        mediaReferenceId: { not: null },
      },
    });
    if (!cv) throw this.cvNotFound();
    return cv;
  }

  private assertExpectedCvVersion(
    cv: Cv,
    expectedAggregateVersion: number,
  ): void {
    if (cv.aggregateVersion !== expectedAggregateVersion) {
      throw this.versionConflict(
        expectedAggregateVersion,
        cv.aggregateVersion,
      );
    }
  }

  private assertWorkflowVersion(
    workflow: WorkflowWithCleanup,
    expectedAggregateVersion: number,
  ): void {
    if (
      workflow.expectedAggregateVersion !==
        expectedAggregateVersion &&
      workflow.resultAggregateVersion !== expectedAggregateVersion
    ) {
      throw this.versionConflict(
        expectedAggregateVersion,
        workflow.resultAggregateVersion,
      );
    }
  }

  private versionConflict(
    expectedAggregateVersion: number,
    actualAggregateVersion: number,
  ): ApiException {
    return new ApiException(
      'CV_VERSION_CONFLICT',
      'The CV changed after it was read; reload it and retry',
      HttpStatus.CONFLICT,
      { expectedAggregateVersion, actualAggregateVersion },
    );
  }

  private async assertCvDefaultInvariant(
    transaction: Transaction,
  ): Promise<void> {
    await transaction.$executeRawUnsafe(
      'SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE',
    );
  }

  private toLegacySoftResponse(cv: Cv): DeletedCvResponseDto {
    if (!cv.isDeleted || cv.deletedAt === null) {
      throw this.invalidDeletionState();
    }
    return {
      id: cv.id,
      userId: cv.userId,
      deletionMode: 'SOFT',
      isDeleted: true,
      deletedAt: cv.deletedAt.toISOString(),
      replacementDefaultCvId: null,
      aggregateVersion: cv.aggregateVersion,
      cleanupPending: false,
    };
  }

  private toWorkflowResponse(
    workflow: WorkflowWithCleanup,
    cleanupPending?: boolean,
  ): DeletedCvResponseDto {
    const hard =
      workflow.state === CvDeletionState.HARD_DELETED;
    if (
      !hard &&
      workflow.state !== CvDeletionState.SOFT_RETAINED
    ) {
      throw this.invalidDeletionState();
    }
    return {
      id: workflow.cvId,
      userId: workflow.userId,
      deletionMode: hard ? 'HARD' : 'SOFT',
      isDeleted: true,
      deletedAt: workflow.deletedAt.toISOString(),
      replacementDefaultCvId:
        workflow.replacementDefaultCvId,
      aggregateVersion: workflow.resultAggregateVersion,
      cleanupPending:
        hard
          ? (cleanupPending ??
            workflow.cleanup?.status !==
              CvMediaCleanupStatus.SUCCEEDED)
          : false,
    };
  }

  private toPendingResponse(
    workflow: WorkflowWithCleanup,
  ): DeletedCvResponseDto {
    if (workflow.state !== CvDeletionState.PENDING_FENCE) {
      throw this.invalidDeletionState();
    }
    return {
      id: workflow.cvId,
      userId: workflow.userId,
      deletionMode: 'PENDING',
      isDeleted: true,
      deletedAt: workflow.deletedAt.toISOString(),
      replacementDefaultCvId: workflow.replacementDefaultCvId,
      aggregateVersion: workflow.resultAggregateVersion,
      cleanupPending: false,
    };
  }

  private cvNotFound(): ApiException {
    return new ApiException(
      'CV_NOT_FOUND',
      'The requested CV was not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private invalidApplicationDecision(): ApiException {
    return new ApiException(
      'APPLICATION_CV_DELETION_FENCE_INVALID',
      'Application Service returned an inconsistent CV deletion decision',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private invalidDeletionState(): ApiException {
    return new ApiException(
      'CV_DELETION_STATE_INVALID',
      'The CV deletion workflow is inconsistent',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private errorCode(error: unknown): string {
    if (error instanceof ApiException) {
      const response = error.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof response.code === 'string'
      ) {
        return this.safeErrorCode(response.code);
      }
    }
    return this.safeErrorCode(
      error instanceof Error ? error.name : 'CV_FENCE_RECONCILE_FAILED',
    );
  }

  private safeErrorCode(value: string): string {
    const normalized = value
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 96);
    return normalized || 'CV_FENCE_RECONCILE_FAILED';
  }

  private readOptions(config: ConfigService): ReconcileOptions {
    const applicationTimeoutMs = this.readInteger(
      config,
      'APPLICATION_REQUEST_TIMEOUT_MS',
      100,
      10_000,
      3000,
    );
    const options = {
      enabled: this.readBoolean(
        config,
        'CV_DELETION_RECONCILE_ENABLED',
        true,
      ),
      intervalMs:
        this.readInteger(
          config,
          'CV_DELETION_RECONCILE_INTERVAL_SECONDS',
          1,
          3600,
          DEFAULT_RECONCILE_INTERVAL_MS / 1000,
        ) * 1000,
      batchSize: this.readInteger(
        config,
        'CV_DELETION_RECONCILE_BATCH_SIZE',
        1,
        100,
        DEFAULT_RECONCILE_BATCH_SIZE,
      ),
      leaseMs:
        this.readInteger(
          config,
          'CV_DELETION_FENCE_LEASE_SECONDS',
          10,
          1800,
          DEFAULT_FENCE_LEASE_MS / 1000,
        ) * 1000,
      retryBaseMs:
        this.readInteger(
          config,
          'CV_DELETION_RETRY_BASE_SECONDS',
          1,
          3600,
          DEFAULT_RETRY_BASE_MS / 1000,
        ) * 1000,
      retryMaxMs:
        this.readInteger(
          config,
          'CV_DELETION_RETRY_MAX_SECONDS',
          1,
          86400,
          DEFAULT_RETRY_MAX_MS / 1000,
        ) * 1000,
    };
    if (
      options.retryMaxMs < options.retryBaseMs ||
      options.leaseMs < applicationTimeoutMs + 5000
    ) {
      throw new Error('CV deletion reconciler configuration is invalid');
    }
    return options;
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
