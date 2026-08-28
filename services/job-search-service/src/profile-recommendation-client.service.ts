import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobType } from '@prisma/client';
import {
  configuredServiceUrl,
  configuredTimeout,
  hasExactKeys,
  isPlainObject,
  isUuidV4,
  readBoundedJson,
} from './recommendation-http';

const MAX_ACTIVE_CVS = 5;
const MAX_TARGET_ROLES = 10;
const MAX_PREFERRED_LOCATIONS = 5;
const MAX_PREFERRED_JOB_TYPES = 4;
const MAX_VERSION = 2_147_483_647;
const PREFERENCE_V1_JOB_TYPES: ReadonlySet<JobType> = Object.freeze(
  new Set<JobType>([
    JobType.FULL_TIME,
    JobType.PART_TIME,
    JobType.REMOTE,
    JobType.INTERNSHIP,
  ]),
);
const ENVELOPE_KEYS = ['data', 'meta'] as const;
const PREFERENCE_KEYS = [
  'schemaVersion',
  'candidateId',
  'state',
  'version',
  'consentVersion',
  'consentedAt',
  'withdrawnAt',
  'targetRoles',
  'preferredLocations',
  'preferredJobTypes',
  'minimumSalary',
  'currency',
  'createdAt',
  'updatedAt',
] as const;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ILIKE_META_CHARACTER_PATTERN = /[%_\\]/u;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_SALARY_PATTERN =
  /^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/;

export interface RecommendationCv {
  cvId: string;
}

export enum JobPreferenceState {
  UNSET = 'UNSET',
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
}

export interface JobRecommendationPreferences {
  schemaVersion: 1;
  candidateId: string;
  state: JobPreferenceState;
  version: number;
  consentVersion: 1 | null;
  consentedAt: string | null;
  withdrawnAt: string | null;
  targetRoles: readonly string[];
  preferredLocations: readonly string[];
  preferredJobTypes: readonly JobType[];
  minimumSalary: string | null;
  currency: 'VND';
  createdAt: string | null;
  updatedAt: string | null;
}

export class ProfileRecommendationUnavailableError extends Error {
  constructor() {
    super('PROFILE_RECOMMENDATION_UNAVAILABLE');
    this.name = 'ProfileRecommendationUnavailableError';
  }
}

interface ValidCv {
  id: string;
  createdAt: number;
  isDefault: boolean;
}

@Injectable()
export class ProfileRecommendationClientService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = configuredServiceUrl(
      config,
      'PROFILE_SERVICE_URL',
      'PROFILE_SERVICE_ALLOWED_HOSTS',
      'http://profile-service:3000',
    );
    this.timeoutMs = configuredTimeout(config, 'PROFILE_REQUEST_TIMEOUT_MS');
  }

  async getPreferredCv(
    candidateId: string,
    authorization: string,
  ): Promise<RecommendationCv | null> {
    this.assertRequest(candidateId, authorization);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/cvs`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProfileRecommendationUnavailableError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProfileRecommendationUnavailableError();
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new ProfileRecommendationUnavailableError();
    }
    const cvs = this.validateEnvelope(body, candidateId);
    if (cvs.length === 0) return null;

    const defaultCvs = cvs.filter(({ isDefault }) => isDefault);
    if (defaultCvs.length > 1) {
      throw new ProfileRecommendationUnavailableError();
    }
    const selected = defaultCvs[0] ?? [...cvs].sort((left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id)
    )[0];
    return { cvId: selected.id };
  }

  async getJobPreferences(
    candidateId: string,
    authorization: string,
  ): Promise<JobRecommendationPreferences> {
    this.assertRequest(candidateId, authorization);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/job-preferences`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProfileRecommendationUnavailableError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProfileRecommendationUnavailableError();
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new ProfileRecommendationUnavailableError();
    }
    return this.validatePreferences(body, candidateId);
  }

  private assertRequest(
    candidateId: string,
    authorization: string,
  ): void {
    if (
      !isUuidV4(candidateId) ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i
        .test(authorization) ||
      authorization.length > 8_192 ||
      CONTROL_CHARACTER_PATTERN.test(authorization)
    ) {
      throw new ProfileRecommendationUnavailableError();
    }
  }

  private validatePreferences(
    body: unknown,
    candidateId: string,
  ): JobRecommendationPreferences {
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, ENVELOPE_KEYS) ||
      body.meta !== null ||
      !isPlainObject(body.data) ||
      !hasExactKeys(body.data, PREFERENCE_KEYS)
    ) {
      throw new ProfileRecommendationUnavailableError();
    }

    const data = body.data;
    const state = data.state;
    const version = data.version;
    const consentVersion = data.consentVersion;
    const candidate = data.candidateId;
    if (
      data.schemaVersion !== 1 ||
      !isUuidV4(candidate) ||
      candidate !== candidate.toLowerCase() ||
      candidate !== candidateId.toLowerCase() ||
      !Object.values(JobPreferenceState).includes(
        state as JobPreferenceState,
      ) ||
      !Number.isSafeInteger(version) ||
      (version as number) < 0 ||
      (version as number) > MAX_VERSION ||
      data.currency !== 'VND'
    ) {
      throw new ProfileRecommendationUnavailableError();
    }

    const targetRoles = this.validateCanonicalStrings(
      data.targetRoles,
      MAX_TARGET_ROLES,
      120,
    );
    const preferredLocations = this.validateCanonicalStrings(
      data.preferredLocations,
      MAX_PREFERRED_LOCATIONS,
      255,
    );
    const preferredJobTypes = this.validateJobTypes(
      data.preferredJobTypes,
    );
    const minimumSalary = this.validateSalary(data.minimumSalary);
    const consentedAt = this.validateTimestamp(data.consentedAt);
    const withdrawnAt = this.validateTimestamp(data.withdrawnAt);
    const createdAt = this.validateTimestamp(data.createdAt);
    const updatedAt = this.validateTimestamp(data.updatedAt);

    if (state === JobPreferenceState.UNSET) {
      if (
        version !== 0 ||
        consentVersion !== null ||
        consentedAt !== null ||
        withdrawnAt !== null ||
        createdAt !== null ||
        updatedAt !== null ||
        !this.isRedacted(
          targetRoles,
          preferredLocations,
          preferredJobTypes,
          minimumSalary,
        )
      ) {
        throw new ProfileRecommendationUnavailableError();
      }
    } else if (state === JobPreferenceState.ENABLED) {
      if (
        (version as number) < 1 ||
        consentVersion !== 1 ||
        consentedAt === null ||
        withdrawnAt !== null ||
        createdAt === null ||
        updatedAt === null ||
        updatedAt.epoch < createdAt.epoch ||
        consentedAt.epoch < createdAt.epoch ||
        consentedAt.epoch > updatedAt.epoch ||
        targetRoles.length + preferredLocations.length +
          preferredJobTypes.length + (minimumSalary === null ? 0 : 1) < 1
      ) {
        throw new ProfileRecommendationUnavailableError();
      }
    } else if (
      (version as number) < 1 ||
      consentVersion !== null ||
      withdrawnAt === null ||
      createdAt === null ||
      updatedAt === null ||
      updatedAt.epoch < createdAt.epoch ||
      withdrawnAt.epoch < createdAt.epoch ||
      withdrawnAt.epoch > updatedAt.epoch ||
      (consentedAt !== null && consentedAt.epoch < createdAt.epoch) ||
      (consentedAt !== null && consentedAt.epoch > updatedAt.epoch) ||
      (consentedAt !== null && consentedAt.epoch > withdrawnAt.epoch) ||
      !this.isRedacted(
        targetRoles,
        preferredLocations,
        preferredJobTypes,
        minimumSalary,
      )
    ) {
      throw new ProfileRecommendationUnavailableError();
    }

    return {
      schemaVersion: 1,
      candidateId: candidate,
      state: state as JobPreferenceState,
      version: version as number,
      consentVersion: consentVersion as 1 | null,
      consentedAt: consentedAt?.value ?? null,
      withdrawnAt: withdrawnAt?.value ?? null,
      targetRoles,
      preferredLocations,
      preferredJobTypes,
      minimumSalary,
      currency: 'VND',
      createdAt: createdAt?.value ?? null,
      updatedAt: updatedAt?.value ?? null,
    };
  }

  private validateCanonicalStrings(
    value: unknown,
    maximumItems: number,
    maximumLength: number,
  ): readonly string[] {
    if (!Array.isArray(value) || value.length > maximumItems) {
      throw new ProfileRecommendationUnavailableError();
    }
    const canonical = value.map((item): string => {
      if (typeof item !== 'string') {
        throw new ProfileRecommendationUnavailableError();
      }
      const normalized = item.normalize('NFKC')
        .replace(/\p{White_Space}+/gu, ' ')
        .trim();
      const length = Array.from(normalized).length;
      if (
        hasPostgresUnsafeUnicode(item) ||
        item !== normalized ||
        length < 1 ||
        length > maximumLength ||
        CONTROL_CHARACTER_PATTERN.test(item) ||
        ILIKE_META_CHARACTER_PATTERN.test(item)
      ) {
        throw new ProfileRecommendationUnavailableError();
      }
      return item;
    });
    const normalizedNames = canonical.map((item) => item.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      throw new ProfileRecommendationUnavailableError();
    }
    return Object.freeze([...canonical]);
  }

  private validateJobTypes(value: unknown): readonly JobType[] {
    if (!Array.isArray(value) || value.length > MAX_PREFERRED_JOB_TYPES) {
      throw new ProfileRecommendationUnavailableError();
    }
    if (
      value.some((item) =>
        typeof item !== 'string' ||
        !PREFERENCE_V1_JOB_TYPES.has(item as JobType)) ||
      new Set(value).size !== value.length
    ) {
      throw new ProfileRecommendationUnavailableError();
    }
    return Object.freeze([...(value as JobType[])]);
  }

  private validateSalary(value: unknown): string | null {
    if (value === null) return null;
    if (
      typeof value !== 'string' ||
      !CANONICAL_SALARY_PATTERN.test(value)
    ) {
      throw new ProfileRecommendationUnavailableError();
    }
    const [integer, fraction] = value.split('.');
    const minorUnits = BigInt(integer) * 100n + BigInt(fraction);
    if (
      minorUnits < 1n ||
      minorUnits > 999_999_999_999_999n
    ) {
      throw new ProfileRecommendationUnavailableError();
    }
    return value;
  }

  private validateTimestamp(
    value: unknown,
  ): { value: string; epoch: number } | null {
    if (value === null) return null;
    if (
      typeof value !== 'string' ||
      !CANONICAL_TIMESTAMP_PATTERN.test(value)
    ) {
      throw new ProfileRecommendationUnavailableError();
    }
    const epoch = Date.parse(value);
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
      throw new ProfileRecommendationUnavailableError();
    }
    return { value, epoch };
  }

  private isRedacted(
    targetRoles: readonly string[],
    preferredLocations: readonly string[],
    preferredJobTypes: readonly JobType[],
    minimumSalary: string | null,
  ): boolean {
    return targetRoles.length === 0 &&
      preferredLocations.length === 0 &&
      preferredJobTypes.length === 0 &&
      minimumSalary === null;
  }

  private validateEnvelope(body: unknown, candidateId: string): ValidCv[] {
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, ENVELOPE_KEYS) ||
      body.meta !== null ||
      !Array.isArray(body.data) ||
      body.data.length > MAX_ACTIVE_CVS
    ) {
      throw new ProfileRecommendationUnavailableError();
    }

    const ids = new Set<string>();
    return body.data.map((value): ValidCv => {
      if (!isPlainObject(value)) {
        throw new ProfileRecommendationUnavailableError();
      }
      const id = value.id;
      const userId = value.userId;
      const fileId = value.fileId;
      const type = value.type;
      const createdAt = value.createdAt;
      if (
        !isUuidV4(id) ||
        !isUuidV4(userId) ||
        userId.toLowerCase() !== candidateId.toLowerCase() ||
        !isUuidV4(fileId) ||
        !['UPLOAD', 'ONLINE'].includes(type as string) ||
        value.fileUrl !== null ||
        typeof value.isDefault !== 'boolean' ||
        typeof createdAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
          createdAt,
        )
      ) {
        throw new ProfileRecommendationUnavailableError();
      }
      const createdAtMs = Date.parse(createdAt);
      const canonicalId = id.toLowerCase();
      if (
        !Number.isFinite(createdAtMs) ||
        new Date(createdAtMs).toISOString() !== createdAt ||
        ids.has(canonicalId)
      ) {
        throw new ProfileRecommendationUnavailableError();
      }
      ids.add(canonicalId);
      return {
        id: canonicalId,
        createdAt: createdAtMs,
        isDefault: value.isDefault,
      };
    });
  }
}

function hasPostgresUnsafeUnicode(value: string): boolean {
  if (value.includes('\u0000')) return true;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}
