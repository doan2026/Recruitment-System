import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CandidateRecruiterDiscovery,
  Prisma,
  RecruiterDiscoveryState,
} from '@prisma/client';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  PutRecruiterDiscoveryDto,
  RECRUITER_DISCOVERY_CONSENT_VERSION,
  RECRUITER_DISCOVERY_MAX_VERSION,
  RECRUITER_DISCOVERY_PURPOSE,
  RECRUITER_DISCOVERY_RESOLVE_LIMIT,
  RECRUITER_DISCOVERY_SCHEMA_VERSION,
  RECRUITER_DISCOVERY_SHARED_FIELDS,
  RECRUITER_DISCOVERY_SNAPSHOT_LIMIT,
  RecruiterDiscoveryProjectionState,
  RecruiterDiscoveryResolveRequestDto,
  RecruiterDiscoveryResolvedCandidateDto,
  RecruiterDiscoveryResolvedDto,
  RecruiterDiscoveryResponseDto,
  RecruiterDiscoverySnapshotDto,
} from './dto/recruiter-discovery.dto';

type Transaction = Prisma.TransactionClient;

interface LockedDiscovery {
  state: RecruiterDiscoveryState;
  version: number;
  cvId: string | null;
  consentedAt: Date | null;
  withdrawnAt: Date | null;
}

interface PreparedDiscovery {
  state: RecruiterDiscoveryState;
  consentVersion: typeof RECRUITER_DISCOVERY_CONSENT_VERSION | null;
  cvId: string | null;
}

interface SnapshotRow {
  candidateId: string;
  cvId: string;
  discoveryVersion: number;
  profileVersion: number;
  fullName: string;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

@Injectable()
export class RecruiterDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(candidateId: string): Promise<RecruiterDiscoveryResponseDto> {
    const canonicalCandidateId = this.canonicalUuid(candidateId);
    const discovery = await this.prisma.$transaction(
      (transaction) =>
        transaction.candidateRecruiterDiscovery.findUnique({
          where: { candidateId: canonicalCandidateId },
        }),
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
    return discovery
      ? this.toResponse(discovery)
      : this.unsetResponse(canonicalCandidateId);
  }

  async replace(
    candidateId: string,
    dto: PutRecruiterDiscoveryDto,
  ): Promise<RecruiterDiscoveryResponseDto> {
    const canonicalCandidateId = this.canonicalUuid(candidateId);
    const prepared = this.prepare(dto);

    const discovery = await this.runMutation(async (transaction) => {
      await this.lockOrCreateProfile(transaction, canonicalCandidateId);
      const current = await this.lockDiscovery(
        transaction,
        canonicalCandidateId,
      );
      const actualVersion = current?.version ?? 0;
      if (actualVersion !== dto.expectedVersion) {
        throw this.versionConflict(dto.expectedVersion, actualVersion);
      }
      if (actualVersion >= RECRUITER_DISCOVERY_MAX_VERSION) {
        throw new ApiException(
          'RECRUITER_DISCOVERY_VERSION_EXHAUSTED',
          'Recruiter discovery version cannot be incremented further',
          HttpStatus.CONFLICT,
        );
      }
      if (prepared.cvId !== null) {
        await this.requireEligibleCv(
          transaction,
          canonicalCandidateId,
          prepared.cvId,
        );
      }

      const now = await this.databaseNow(transaction);
      const changedGrant =
        prepared.state === RecruiterDiscoveryState.ENABLED &&
        (
          current?.state !== RecruiterDiscoveryState.ENABLED ||
          current.cvId !== prepared.cvId
        );
      const consentedAt =
        prepared.state === RecruiterDiscoveryState.ENABLED
          ? changedGrant
            ? now
            : current?.consentedAt ?? now
          : current?.consentedAt ?? null;
      const withdrawnAt =
        prepared.state === RecruiterDiscoveryState.DISABLED
          ? current?.state === RecruiterDiscoveryState.DISABLED
            ? current.withdrawnAt
            : now
          : null;

      if (!current) {
        return transaction.candidateRecruiterDiscovery.create({
          data: {
            candidateId: canonicalCandidateId,
            schemaVersion: RECRUITER_DISCOVERY_SCHEMA_VERSION,
            state: prepared.state,
            version: 1,
            consentVersion: prepared.consentVersion,
            cvId: prepared.cvId,
            consentedAt,
            withdrawnAt,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      return transaction.candidateRecruiterDiscovery.update({
        where: { candidateId: canonicalCandidateId },
        data: {
          state: prepared.state,
          version: { increment: 1 },
          consentVersion: prepared.consentVersion,
          cvId: prepared.cvId,
          consentedAt,
          withdrawnAt,
          updatedAt: now,
        },
      });
    });

    return this.toResponse(discovery);
  }

  async snapshot(): Promise<RecruiterDiscoverySnapshotDto> {
    const rows = await this.prisma.$transaction(
      (transaction) => transaction.$queryRaw<SnapshotRow[]>`
        SELECT
          discovery."candidate_id"::text AS "candidateId",
          discovery."cv_id"::text AS "cvId",
          discovery."version" AS "discoveryVersion",
          profile."aggregate_version" AS "profileVersion",
          profile."full_name" AS "fullName"
        FROM "profile"."candidate_recruiter_discovery" AS discovery
        JOIN "profile"."profiles" AS profile
          ON profile."user_id" = discovery."candidate_id"
        JOIN "profile"."cvs" AS cv
          ON cv."id" = discovery."cv_id"
         AND cv."user_id" = discovery."candidate_id"
        WHERE discovery."state" = 'ENABLED'
          AND discovery."consent_version" = 1
          AND cv."is_deleted" = false
          AND cv."file_url" IS NULL
          AND cv."media_reference_id" IS NOT NULL
          AND profile."full_name" IS NOT NULL
          AND CHAR_LENGTH(BTRIM(profile."full_name")) BETWEEN 1 AND 160
          AND BTRIM(profile."full_name") !~ '[[:cntrl:]]'
        ORDER BY discovery."candidate_id" ASC
        LIMIT ${RECRUITER_DISCOVERY_SNAPSHOT_LIMIT + 1}
      `,
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

    if (rows.length > RECRUITER_DISCOVERY_SNAPSHOT_LIMIT) {
      throw new ApiException(
        'RECRUITER_DISCOVERY_SNAPSHOT_LIMIT_EXCEEDED',
        'Recruiter discovery snapshot exceeds the supported limit',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const candidates = rows.flatMap((row) => {
      if (
        !UUID_V4_PATTERN.test(row.candidateId) ||
        !UUID_V4_PATTERN.test(row.cvId) ||
        !Number.isSafeInteger(row.discoveryVersion) ||
        row.discoveryVersion < 1 ||
        !Number.isSafeInteger(row.profileVersion) ||
        row.profileVersion < 1 ||
        this.canonicalSharedText(row.fullName, 160) === null
      ) {
        return [];
      }
      return [{
        candidateId: row.candidateId.toLowerCase(),
        cvId: row.cvId.toLowerCase(),
        discoveryVersion: row.discoveryVersion,
        profileVersion: row.profileVersion,
      }];
    });

    return {
      schemaVersion: RECRUITER_DISCOVERY_SCHEMA_VERSION,
      purpose: RECRUITER_DISCOVERY_PURPOSE,
      candidates,
    };
  }

  async resolve(
    request: RecruiterDiscoveryResolveRequestDto,
  ): Promise<RecruiterDiscoveryResolvedDto> {
    if (
      request.schemaVersion !== RECRUITER_DISCOVERY_SCHEMA_VERSION ||
      request.purpose !== RECRUITER_DISCOVERY_PURPOSE ||
      !Array.isArray(request.candidates) ||
      request.candidates.length < 1 ||
      request.candidates.length > RECRUITER_DISCOVERY_RESOLVE_LIMIT ||
      request.candidates.some((candidate) =>
        !UUID_V4_PATTERN.test(candidate.candidateId) ||
        !UUID_V4_PATTERN.test(candidate.cvId) ||
        !Number.isSafeInteger(candidate.discoveryVersion) ||
        candidate.discoveryVersion < 1 ||
        candidate.discoveryVersion > RECRUITER_DISCOVERY_MAX_VERSION ||
        !Number.isSafeInteger(candidate.profileVersion) ||
        candidate.profileVersion < 1 ||
        candidate.profileVersion > RECRUITER_DISCOVERY_MAX_VERSION
      )
    ) {
      throw new ApiException(
        'RECRUITER_DISCOVERY_EXPECTATION_INVALID',
        'Expected recruiter discovery candidates are invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.requireUniqueExpectedCandidates(request);
    const candidateIds = request.candidates.map(({ candidateId }) =>
      this.canonicalUuid(candidateId)
    );
    const cvIds = request.candidates.map(({ cvId }) =>
      this.canonicalUuid(cvId)
    );

    const snapshot = await this.prisma.$transaction(
      async (transaction) => {
        const [discoveries, profiles, cvs] = await Promise.all([
          transaction.candidateRecruiterDiscovery.findMany({
            where: { candidateId: { in: candidateIds } },
          }),
          transaction.profile.findMany({
            where: { userId: { in: candidateIds } },
            include: {
              skills: {
                orderBy: [
                  { sortOrder: 'asc' },
                  { id: 'asc' },
                ],
                take: 101,
              },
            },
          }),
          transaction.cv.findMany({
            where: {
              id: { in: cvIds },
              isDeleted: false,
              fileUrl: null,
              mediaReferenceId: { not: null },
            },
            select: { id: true, userId: true },
          }),
        ]);
        return { discoveries, profiles, cvs };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

    const discoveries = new Map(
      snapshot.discoveries.map((value) => [value.candidateId, value]),
    );
    const profiles = new Map(
      snapshot.profiles.map((value) => [value.userId, value]),
    );
    const cvs = new Map(
      snapshot.cvs.map((value) => [value.id, value]),
    );
    const candidates: RecruiterDiscoveryResolvedCandidateDto[] = [];

    for (const expected of request.candidates) {
      const candidateId = expected.candidateId.toLowerCase();
      const cvId = expected.cvId.toLowerCase();
      const discovery = discoveries.get(candidateId);
      const profile = profiles.get(candidateId);
      const cv = cvs.get(cvId);
      if (
        !discovery ||
        discovery.state !== RecruiterDiscoveryState.ENABLED ||
        discovery.consentVersion !== RECRUITER_DISCOVERY_CONSENT_VERSION ||
        discovery.cvId?.toLowerCase() !== cvId ||
        discovery.version !== expected.discoveryVersion ||
        !profile ||
        profile.aggregateVersion !== expected.profileVersion ||
        !cv ||
        cv.userId.toLowerCase() !== candidateId
      ) {
        continue;
      }
      const projection = this.safeProjection(
        candidateId,
        profile.fullName,
        profile.headline,
        profile.skills.map(({ name }) => name),
      );
      if (projection) candidates.push(projection);
    }

    return {
      schemaVersion: RECRUITER_DISCOVERY_SCHEMA_VERSION,
      purpose: RECRUITER_DISCOVERY_PURPOSE,
      candidates,
    };
  }

  private prepare(dto: PutRecruiterDiscoveryDto): PreparedDiscovery {
    if (
      !Number.isInteger(dto.expectedVersion) ||
      dto.expectedVersion < 0 ||
      dto.expectedVersion > RECRUITER_DISCOVERY_MAX_VERSION ||
      dto.purpose !== RECRUITER_DISCOVERY_PURPOSE
    ) {
      throw this.invalid('Recruiter discovery request is invalid');
    }
    if (dto.state === RecruiterDiscoveryState.ENABLED) {
      if (
        dto.consentVersion !== RECRUITER_DISCOVERY_CONSENT_VERSION ||
        typeof dto.cvId !== 'string' ||
        !UUID_V4_PATTERN.test(dto.cvId)
      ) {
        throw this.invalid(
          'ENABLED recruiter discovery requires consent v1 and one CV',
        );
      }
      return {
        state: RecruiterDiscoveryState.ENABLED,
        consentVersion: RECRUITER_DISCOVERY_CONSENT_VERSION,
        cvId: dto.cvId.toLowerCase(),
      };
    }
    if (dto.state === RecruiterDiscoveryState.DISABLED) {
      if (dto.consentVersion !== null || dto.cvId !== null) {
        throw this.invalid(
          'DISABLED recruiter discovery must clear consent and CV',
        );
      }
      return {
        state: RecruiterDiscoveryState.DISABLED,
        consentVersion: null,
        cvId: null,
      };
    }
    throw this.invalid('state must be ENABLED or DISABLED');
  }

  private async lockOrCreateProfile(
    transaction: Transaction,
    candidateId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id"
      FROM "profile"."profiles"
      WHERE "user_id" = ${candidateId}::uuid
      FOR UPDATE
    `;
    if (rows[0]) return;
    await transaction.profile.create({
      data: { userId: candidateId },
      select: { id: true },
    });
  }

  private async lockDiscovery(
    transaction: Transaction,
    candidateId: string,
  ): Promise<LockedDiscovery | null> {
    const rows = await transaction.$queryRaw<LockedDiscovery[]>`
      SELECT
        "state",
        "version",
        "cv_id"::text AS "cvId",
        "consented_at" AS "consentedAt",
        "withdrawn_at" AS "withdrawnAt"
      FROM "profile"."candidate_recruiter_discovery"
      WHERE "candidate_id" = ${candidateId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async requireEligibleCv(
    transaction: Transaction,
    candidateId: string,
    cvId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id"
      FROM "profile"."cvs"
      WHERE "id" = ${cvId}::uuid
        AND "user_id" = ${candidateId}::uuid
        AND "is_deleted" = false
        AND "file_url" IS NULL
        AND "media_reference_id" IS NOT NULL
      FOR SHARE
    `;
    if (rows[0]) return;
    throw new ApiException(
      'RECRUITER_DISCOVERY_CV_NOT_AVAILABLE',
      'The selected CV is not available for recruiter discovery',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private requireUniqueExpectedCandidates(
    request: RecruiterDiscoveryResolveRequestDto,
  ): void {
    const candidateIds = request.candidates.map(({ candidateId }) =>
      candidateId.toLowerCase()
    );
    const cvIds = request.candidates.map(({ cvId }) => cvId.toLowerCase());
    if (
      new Set(candidateIds).size !== candidateIds.length ||
      new Set(cvIds).size !== cvIds.length
    ) {
      throw new ApiException(
        'RECRUITER_DISCOVERY_EXPECTATION_INVALID',
        'Expected recruiter discovery candidates must be unique',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private safeProjection(
    candidateId: string,
    fullNameValue: string | null,
    headlineValue: string | null,
    skillValues: string[],
  ): RecruiterDiscoveryResolvedCandidateDto | null {
    const fullName = this.canonicalSharedText(fullNameValue, 160);
    const headline = headlineValue === null
      ? null
      : this.canonicalSharedText(headlineValue, 200);
    if (
      fullName === null ||
      (headlineValue !== null && headline === null) ||
      skillValues.length > 100
    ) {
      return null;
    }
    const skills = skillValues.map((value) =>
      this.canonicalSharedText(value, 120)
    );
    if (skills.some((value) => value === null)) return null;
    const canonicalSkills = skills as string[];
    const identities = canonicalSkills.map((value) => value.toLowerCase());
    if (new Set(identities).size !== identities.length) return null;
    return { candidateId, fullName, headline, skills: canonicalSkills };
  }

  private canonicalSharedText(
    value: string | null,
    maximumLength: number,
  ): string | null {
    if (typeof value !== 'string') return null;
    const canonical = value
      .normalize('NFKC')
      .replace(/\p{White_Space}+/gu, ' ')
      .trim();
    const length = [...canonical].length;
    return length >= 1 &&
      length <= maximumLength &&
      !CONTROL_CHARACTER_PATTERN.test(canonical)
      ? canonical
      : null;
  }

  private async databaseNow(transaction: Transaction): Promise<Date> {
    const rows = await transaction.$queryRaw<{ now: Date }[]>`
      SELECT DATE_TRUNC('milliseconds', CLOCK_TIMESTAMP()) AS "now"
    `;
    return rows[0].now;
  }

  private async runMutation<T>(
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const maximumAttempts = 8;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        if (
          attempt < maximumAttempts &&
          this.isRetryableTransactionError(error)
        ) {
          await this.waitForRetry(attempt);
          continue;
        }
        this.throwPersistenceError(error);
      }
    }
    throw new ApiException(
      'RECRUITER_DISCOVERY_CONCURRENT_MODIFICATION',
      'Recruiter discovery changed concurrently; retry the request',
      HttpStatus.CONFLICT,
    );
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code === 'P2034') return true;
    if (
      error.code === 'P2010' &&
      String(error.meta?.code ?? '') === '40001'
    ) {
      return true;
    }
    if (error.code !== 'P2002') return false;
    const target = JSON.stringify(error.meta?.target ?? '');
    return [
      'profiles_user_id',
      'user_id',
      'candidate_recruiter_discovery_pkey',
      'candidate_id',
    ].some((name) => target.includes(name));
  }

  private async waitForRetry(attempt: number): Promise<void> {
    const delay =
      Math.min(10 * 2 ** (attempt - 1), 250) +
      Math.floor(Math.random() * 25);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  private throwPersistenceError(error: unknown): never {
    if (error instanceof ApiException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2028') {
        throw new ApiException(
          'RECRUITER_DISCOVERY_TRANSACTION_TIMEOUT',
          'Recruiter discovery transaction timed out; retry the request',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (
        error.code === 'P2034' ||
        error.code === 'P2002' ||
        (error.code === 'P2010' &&
          String(error.meta?.code ?? '') === '40001')
      ) {
        throw new ApiException(
          'RECRUITER_DISCOVERY_CONCURRENT_MODIFICATION',
          'Recruiter discovery changed concurrently; retry the request',
          HttpStatus.CONFLICT,
        );
      }
      if (
        error.code === 'P2004' ||
        (error.code === 'P2010' &&
          String(error.meta?.code ?? '') === '23514')
      ) {
        throw this.invalid(
          'Recruiter discovery violates a persistence constraint',
        );
      }
    }
    throw error;
  }

  private canonicalUuid(value: string): string {
    if (!UUID_V4_PATTERN.test(value)) {
      throw new ApiException(
        'INVALID_CANDIDATE_ID',
        'Candidate id must be a UUID v4',
        HttpStatus.BAD_REQUEST,
      );
    }
    return value.toLowerCase();
  }

  private invalid(message: string): ApiException {
    return new ApiException(
      'RECRUITER_DISCOVERY_INVALID',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  private versionConflict(
    expectedVersion: number,
    actualVersion: number,
  ): ApiException {
    return new ApiException(
      'RECRUITER_DISCOVERY_VERSION_CONFLICT',
      'Recruiter discovery changed since it was read',
      HttpStatus.CONFLICT,
      { expectedVersion, actualVersion },
    );
  }

  private unsetResponse(candidateId: string): RecruiterDiscoveryResponseDto {
    return {
      schemaVersion: RECRUITER_DISCOVERY_SCHEMA_VERSION,
      purpose: RECRUITER_DISCOVERY_PURPOSE,
      sharedFields: [...RECRUITER_DISCOVERY_SHARED_FIELDS],
      candidateId,
      state: RecruiterDiscoveryProjectionState.UNSET,
      version: 0,
      consentVersion: null,
      cvId: null,
      consentedAt: null,
      withdrawnAt: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  private toResponse(
    discovery: CandidateRecruiterDiscovery,
  ): RecruiterDiscoveryResponseDto {
    return {
      schemaVersion: RECRUITER_DISCOVERY_SCHEMA_VERSION,
      purpose: RECRUITER_DISCOVERY_PURPOSE,
      sharedFields: [...RECRUITER_DISCOVERY_SHARED_FIELDS],
      candidateId: discovery.candidateId.toLowerCase(),
      state: discovery.state === RecruiterDiscoveryState.ENABLED
        ? RecruiterDiscoveryProjectionState.ENABLED
        : RecruiterDiscoveryProjectionState.DISABLED,
      version: discovery.version,
      consentVersion: discovery.consentVersion === null
        ? null
        : RECRUITER_DISCOVERY_CONSENT_VERSION,
      cvId: discovery.cvId?.toLowerCase() ?? null,
      consentedAt: discovery.consentedAt?.toISOString() ?? null,
      withdrawnAt: discovery.withdrawnAt?.toISOString() ?? null,
      createdAt: discovery.createdAt.toISOString(),
      updatedAt: discovery.updatedAt.toISOString(),
    };
  }
}
