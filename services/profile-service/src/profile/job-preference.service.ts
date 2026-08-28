import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CandidateJobPreference,
  JobPreferenceState,
  PreferredJobType,
  Prisma,
} from '@prisma/client';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_PREFERENCE_CONSENT_VERSION,
  JOB_PREFERENCE_MAX_VERSION,
  JOB_PREFERENCE_MAXIMUM_SALARY,
  JOB_PREFERENCE_SCHEMA_VERSION,
  JOB_PREFERENCE_V1_JOB_TYPES,
  JobPreferenceProjectionState,
  JobPreferenceResponseDto,
  PutJobPreferenceDto,
  canonicalizeJobPreferenceText,
  hasPostgresSafeJobPreferenceUnicode,
} from './dto/job-preference.dto';

type Transaction = Prisma.TransactionClient;

interface LockedPreference {
  state: JobPreferenceState;
  version: number;
  consentedAt: Date | null;
  withdrawnAt: Date | null;
}

interface PreparedPreference {
  state: JobPreferenceState;
  consentVersion: number | null;
  targetRoles: string[];
  preferredLocations: string[];
  preferredJobTypes: PreferredJobType[];
  minimumSalary: Prisma.Decimal | null;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const EXACT_MATCH_META_CHARACTER_PATTERN = /[%_\\]/u;
const PREFERRED_JOB_TYPES = new Set<string>(
  JOB_PREFERENCE_V1_JOB_TYPES,
);

@Injectable()
export class JobPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(candidateId: string): Promise<JobPreferenceResponseDto> {
    const canonicalCandidateId = this.canonicalCandidateId(candidateId);
    const preference = await this.prisma.$transaction(
      (transaction) =>
        transaction.candidateJobPreference.findUnique({
          where: { candidateId: canonicalCandidateId },
        }),
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

    return preference
      ? this.toResponse(preference)
      : this.unsetResponse(canonicalCandidateId);
  }

  async replace(
    candidateId: string,
    dto: PutJobPreferenceDto,
  ): Promise<JobPreferenceResponseDto> {
    const canonicalCandidateId = this.canonicalCandidateId(candidateId);
    const prepared = this.prepare(dto);

    const preference = await this.runMutation(async (transaction) => {
      await this.lockOrCreateProfile(
        transaction,
        canonicalCandidateId,
      );
      const current = await this.lockPreference(
        transaction,
        canonicalCandidateId,
      );
      const actualVersion = current?.version ?? 0;
      if (actualVersion !== dto.expectedVersion) {
        throw this.versionConflict(dto.expectedVersion, actualVersion);
      }
      if (actualVersion >= JOB_PREFERENCE_MAX_VERSION) {
        throw new ApiException(
          'JOB_PREFERENCE_VERSION_EXHAUSTED',
          'Job preference version cannot be incremented further',
          HttpStatus.CONFLICT,
        );
      }

      const now = await this.databaseNow(transaction);
      const consentedAt = prepared.state === JobPreferenceState.ENABLED
        ? current?.state === JobPreferenceState.ENABLED
          ? current.consentedAt
          : now
        : (current?.consentedAt ?? null);
      const withdrawnAt = prepared.state === JobPreferenceState.DISABLED
        ? current?.state === JobPreferenceState.DISABLED
          ? current.withdrawnAt
          : now
        : null;

      if (!current) {
        return transaction.candidateJobPreference.create({
          data: {
            candidateId: canonicalCandidateId,
            schemaVersion: JOB_PREFERENCE_SCHEMA_VERSION,
            state: prepared.state,
            version: 1,
            consentVersion: prepared.consentVersion,
            consentedAt,
            withdrawnAt,
            targetRoles: prepared.targetRoles,
            preferredLocations: prepared.preferredLocations,
            preferredJobTypes: prepared.preferredJobTypes,
            minimumSalary: prepared.minimumSalary,
            currency: 'VND',
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      return transaction.candidateJobPreference.update({
        where: { candidateId: canonicalCandidateId },
        data: {
          state: prepared.state,
          version: { increment: 1 },
          consentVersion: prepared.consentVersion,
          consentedAt,
          withdrawnAt,
          targetRoles: prepared.targetRoles,
          preferredLocations: prepared.preferredLocations,
          preferredJobTypes: prepared.preferredJobTypes,
          minimumSalary: prepared.minimumSalary,
          updatedAt: now,
        },
      });
    });

    return this.toResponse(preference);
  }

  private prepare(dto: PutJobPreferenceDto): PreparedPreference {
    if (
      !Number.isInteger(dto.expectedVersion) ||
      dto.expectedVersion < 0 ||
      dto.expectedVersion > JOB_PREFERENCE_MAX_VERSION
    ) {
      throw this.invalid('expectedVersion is outside its supported range');
    }
    if (
      dto.state !== JobPreferenceState.ENABLED &&
      dto.state !== JobPreferenceState.DISABLED
    ) {
      throw this.invalid('state must be ENABLED or DISABLED');
    }

    const targetRoles = this.canonicalTextValues(
      dto.targetRoles,
      10,
      120,
      'targetRoles',
    );
    const preferredLocations = this.canonicalTextValues(
      dto.preferredLocations,
      5,
      255,
      'preferredLocations',
    );
    const preferredJobTypes = this.jobTypes(dto.preferredJobTypes);
    const minimumSalary = this.minimumSalary(dto.minimumSalary);

    if (dto.state === JobPreferenceState.ENABLED) {
      if (dto.consentVersion !== JOB_PREFERENCE_CONSENT_VERSION) {
        throw this.invalid(
          'ENABLED preferences require consentVersion 1',
        );
      }
      if (
        targetRoles.length === 0 &&
        preferredLocations.length === 0 &&
        preferredJobTypes.length === 0 &&
        minimumSalary === null
      ) {
        throw this.invalid(
          'ENABLED preferences require at least one criterion',
        );
      }
    } else if (
      dto.consentVersion !== null ||
      targetRoles.length > 0 ||
      preferredLocations.length > 0 ||
      preferredJobTypes.length > 0 ||
      minimumSalary !== null
    ) {
      throw this.invalid(
        'DISABLED preferences must clear consent and every criterion',
      );
    }

    return {
      state: dto.state,
      consentVersion: dto.consentVersion,
      targetRoles,
      preferredLocations,
      preferredJobTypes,
      minimumSalary,
    };
  }

  private canonicalTextValues(
    values: unknown,
    maximumItems: number,
    maximumLength: number,
    field: string,
  ): string[] {
    if (!Array.isArray(values) || values.length > maximumItems) {
      throw this.invalid(`${field} exceeds its supported item limit`);
    }

    const canonical = values.map((value) => {
      if (typeof value !== 'string') {
        throw this.invalid(`${field} must contain only strings`);
      }
      const result = canonicalizeJobPreferenceText(value);
      const length = [...result].length;
      if (
        length < 1 ||
        length > maximumLength ||
        CONTROL_CHARACTER_PATTERN.test(result) ||
        EXACT_MATCH_META_CHARACTER_PATTERN.test(result) ||
        !hasPostgresSafeJobPreferenceUnicode(result)
      ) {
        throw this.invalid(`${field} contains an invalid value`);
      }
      return result;
    });
    const identities = canonical.map((value) => value.toLowerCase());
    if (new Set(identities).size !== identities.length) {
      throw this.invalid(`${field} contains a case-insensitive duplicate`);
    }
    return canonical;
  }

  private jobTypes(values: unknown): PreferredJobType[] {
    if (!Array.isArray(values) || values.length > 4) {
      throw this.invalid(
        'preferredJobTypes exceeds its supported item limit',
      );
    }
    if (
      values.some(
        (value) =>
          typeof value !== 'string' ||
          !PREFERRED_JOB_TYPES.has(value),
      ) ||
      new Set(values).size !== values.length
    ) {
      throw this.invalid('preferredJobTypes contains an invalid value');
    }
    return [...values] as PreferredJobType[];
  }

  private minimumSalary(value: unknown): Prisma.Decimal | null {
    if (value === null) return null;
    if (
      typeof value !== 'string' ||
      !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)
    ) {
      throw this.invalid('minimumSalary must be a decimal string');
    }

    const salary = new Prisma.Decimal(value);
    const maximum = new Prisma.Decimal(
      JOB_PREFERENCE_MAXIMUM_SALARY,
    );
    if (
      !salary.isFinite() ||
      !salary.greaterThan(0) ||
      salary.greaterThan(maximum) ||
      salary.decimalPlaces() > 2
    ) {
      throw this.invalid('minimumSalary is outside its supported range');
    }
    return salary;
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

  private async lockPreference(
    transaction: Transaction,
    candidateId: string,
  ): Promise<LockedPreference | null> {
    const rows = await transaction.$queryRaw<LockedPreference[]>`
      SELECT
        "state",
        "version",
        "consented_at" AS "consentedAt",
        "withdrawn_at" AS "withdrawnAt"
      FROM "profile"."candidate_job_preferences"
      WHERE "candidate_id" = ${candidateId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
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
      'JOB_PREFERENCE_CONCURRENT_MODIFICATION',
      'Job preferences could not be updated because of concurrent changes',
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
      'candidate_job_preferences_pkey',
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
          'JOB_PREFERENCE_TRANSACTION_TIMEOUT',
          'Job preference transaction timed out; retry the request',
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
          'JOB_PREFERENCE_CONCURRENT_MODIFICATION',
          'Job preferences changed concurrently; retry the request',
          HttpStatus.CONFLICT,
        );
      }
      if (
        error.code === 'P2004' ||
        (error.code === 'P2010' &&
          String(error.meta?.code ?? '') === '23514')
      ) {
        throw this.invalid(
          'Job preferences violate a persistence constraint',
        );
      }
    }
    throw error;
  }

  private canonicalCandidateId(candidateId: string): string {
    if (!UUID_V4_PATTERN.test(candidateId)) {
      throw new ApiException(
        'INVALID_CANDIDATE_ID',
        'Authenticated Candidate id must be a UUID v4',
        HttpStatus.BAD_REQUEST,
      );
    }
    return candidateId.toLowerCase();
  }

  private invalid(message: string): ApiException {
    return new ApiException(
      'JOB_PREFERENCE_INVALID',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  private versionConflict(
    expectedVersion: number,
    actualVersion: number,
  ): ApiException {
    return new ApiException(
      'JOB_PREFERENCE_VERSION_CONFLICT',
      'Job preferences changed since they were read',
      HttpStatus.CONFLICT,
      { expectedVersion, actualVersion },
    );
  }

  private unsetResponse(candidateId: string): JobPreferenceResponseDto {
    return {
      schemaVersion: JOB_PREFERENCE_SCHEMA_VERSION,
      candidateId,
      state: JobPreferenceProjectionState.UNSET,
      version: 0,
      consentVersion: null,
      consentedAt: null,
      withdrawnAt: null,
      targetRoles: [],
      preferredLocations: [],
      preferredJobTypes: [],
      minimumSalary: null,
      currency: 'VND',
      createdAt: null,
      updatedAt: null,
    };
  }

  private toResponse(
    preference: CandidateJobPreference,
  ): JobPreferenceResponseDto {
    return {
      schemaVersion: JOB_PREFERENCE_SCHEMA_VERSION,
      candidateId: preference.candidateId.toLowerCase(),
      state: preference.state === JobPreferenceState.ENABLED
        ? JobPreferenceProjectionState.ENABLED
        : JobPreferenceProjectionState.DISABLED,
      version: preference.version,
      consentVersion: preference.consentVersion === null
        ? null
        : JOB_PREFERENCE_CONSENT_VERSION,
      consentedAt: preference.consentedAt?.toISOString() ?? null,
      withdrawnAt: preference.withdrawnAt?.toISOString() ?? null,
      targetRoles: [...preference.targetRoles],
      preferredLocations: [...preference.preferredLocations],
      preferredJobTypes: [...preference.preferredJobTypes],
      minimumSalary: preference.minimumSalary?.toFixed(2) ?? null,
      currency: 'VND',
      createdAt: preference.createdAt.toISOString(),
      updatedAt: preference.updatedAt.toISOString(),
    };
  }
}
