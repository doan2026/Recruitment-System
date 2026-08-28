import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  configuredServiceUrl,
  configuredTimeout,
  hasExactKeys,
  isPlainObject,
  isUuidV4,
  readBoundedJson,
} from './recommendation-http';

const CALLER_SERVICE = 'job-search-service';
const DISCOVERY_PURPOSE = 'RECRUITER_JOB_RECOMMENDATION';
const DISCOVERY_SCHEMA_VERSION = 1;
const MAX_DISCOVERY_CANDIDATES = 500;
const MAX_RESOLVED_CANDIDATES = 50;
const MAX_VERSION = 2_147_483_647;
const SNAPSHOT_RESPONSE_MAX_BYTES = 262_144;
const RESOLUTION_RESPONSE_MAX_BYTES = 4_194_304;
const ENVELOPE_KEYS = ['data', 'meta'] as const;
const SNAPSHOT_KEYS = ['schemaVersion', 'purpose', 'candidates'] as const;
const ELIGIBILITY_KEYS = [
  'candidateId',
  'cvId',
  'discoveryVersion',
  'profileVersion',
] as const;
const PROFILE_KEYS = ['candidateId', 'fullName', 'headline', 'skills'] as const;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export interface CandidateDiscoveryEligibility {
  candidateId: string;
  cvId: string;
  discoveryVersion: number;
  profileVersion: number;
}

export interface CandidateDiscoveryProfile {
  candidateId: string;
  fullName: string;
  headline: string | null;
  skills: string[];
}

export class ProfileCandidateDiscoveryUnavailableError extends Error {
  constructor() {
    super('PROFILE_CANDIDATE_DISCOVERY_UNAVAILABLE');
    this.name = 'ProfileCandidateDiscoveryUnavailableError';
  }
}

@Injectable()
export class ProfileCandidateDiscoveryClientService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly internalApiKey: string | undefined;

  constructor(config: ConfigService) {
    this.baseUrl = configuredServiceUrl(
      config,
      'PROFILE_SERVICE_URL',
      'PROFILE_SERVICE_ALLOWED_HOSTS',
      'http://profile-service:3000',
    );
    this.timeoutMs = configuredTimeout(config, 'PROFILE_REQUEST_TIMEOUT_MS');
    this.internalApiKey = config.get<string>('PROFILE_INTERNAL_API_KEY');
  }

  isConfigured(): boolean {
    return this.configuredApiKey() !== undefined;
  }

  async getSnapshot(): Promise<CandidateDiscoveryEligibility[]> {
    const body = await this.post(
      '/internal/v1/recruiter-discovery/snapshot',
      {
        schemaVersion: DISCOVERY_SCHEMA_VERSION,
        purpose: DISCOVERY_PURPOSE,
      },
      SNAPSHOT_RESPONSE_MAX_BYTES,
    );
    const candidates = this.parseDataCandidates(body, MAX_DISCOVERY_CANDIDATES);
    return this.parseEligibility(candidates);
  }

  async resolve(
    candidates: readonly CandidateDiscoveryEligibility[],
  ): Promise<CandidateDiscoveryProfile[]> {
    if (
      candidates.length < 1 ||
      candidates.length > MAX_RESOLVED_CANDIDATES ||
      !this.isValidResolutionScope(candidates)
    ) {
      throw new ProfileCandidateDiscoveryUnavailableError();
    }
    const body = await this.post(
      '/internal/v1/recruiter-discovery/resolve',
      {
        schemaVersion: DISCOVERY_SCHEMA_VERSION,
        purpose: DISCOVERY_PURPOSE,
        candidates,
      },
      RESOLUTION_RESPONSE_MAX_BYTES,
    );
    const values = this.parseDataCandidates(body, candidates.length);
    return this.parseProfiles(values, candidates);
  }

  private async post(
    path: string,
    payload: unknown,
    maximumResponseBytes: number,
  ): Promise<unknown> {
    const internalApiKey = this.configuredApiKey();
    if (!internalApiKey) {
      throw new ProfileCandidateDiscoveryUnavailableError();
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-internal-api-key': internalApiKey,
          'x-internal-service': CALLER_SERVICE,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProfileCandidateDiscoveryUnavailableError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProfileCandidateDiscoveryUnavailableError();
    }
    try {
      return await readBoundedJson(response, maximumResponseBytes);
    } catch {
      throw new ProfileCandidateDiscoveryUnavailableError();
    }
  }

  private parseDataCandidates(
    body: unknown,
    maximum: number,
  ): unknown[] {
    if (
      !isPlainObject(body) ||
      !hasExactKeys(body, ENVELOPE_KEYS) ||
      body.meta !== null ||
      !isPlainObject(body.data) ||
      !hasExactKeys(body.data, SNAPSHOT_KEYS) ||
      body.data.schemaVersion !== DISCOVERY_SCHEMA_VERSION ||
      body.data.purpose !== DISCOVERY_PURPOSE ||
      !Array.isArray(body.data.candidates) ||
      body.data.candidates.length > maximum
    ) {
      throw new ProfileCandidateDiscoveryUnavailableError();
    }
    return body.data.candidates;
  }

  private parseEligibility(
    values: readonly unknown[],
  ): CandidateDiscoveryEligibility[] {
    const candidates = values.map((value) => {
      if (
        !isPlainObject(value) ||
        !hasExactKeys(value, ELIGIBILITY_KEYS) ||
        !this.isCanonicalUuid(value.candidateId) ||
        !this.isCanonicalUuid(value.cvId) ||
        !this.isVersion(value.discoveryVersion) ||
        !this.isVersion(value.profileVersion)
      ) {
        throw new ProfileCandidateDiscoveryUnavailableError();
      }
      return {
        candidateId: value.candidateId,
        cvId: value.cvId,
        discoveryVersion: value.discoveryVersion,
        profileVersion: value.profileVersion,
      };
    });
    if (!this.isCanonicalEligibility(candidates)) {
      throw new ProfileCandidateDiscoveryUnavailableError();
    }
    return candidates;
  }

  private parseProfiles(
    values: readonly unknown[],
    requested: readonly CandidateDiscoveryEligibility[],
  ): CandidateDiscoveryProfile[] {
    const positions = new Map(
      requested.map(({ candidateId }, index) => [candidateId, index]),
    );
    let previousPosition = -1;
    const seen = new Set<string>();
    return values.map((value) => {
      if (
        !isPlainObject(value) ||
        !hasExactKeys(value, PROFILE_KEYS) ||
        !this.isCanonicalUuid(value.candidateId) ||
        !this.isCanonicalText(value.fullName, 160) ||
        !(
          value.headline === null ||
          this.isCanonicalText(value.headline, 200)
        ) ||
        !Array.isArray(value.skills) ||
        value.skills.length > 100
      ) {
        throw new ProfileCandidateDiscoveryUnavailableError();
      }
      const position = positions.get(value.candidateId);
      if (
        position === undefined ||
        position <= previousPosition ||
        seen.has(value.candidateId)
      ) {
        throw new ProfileCandidateDiscoveryUnavailableError();
      }
      const normalizedSkills = new Set<string>();
      const skills = value.skills.map((skill) => {
        if (!this.isCanonicalText(skill, 120)) {
          throw new ProfileCandidateDiscoveryUnavailableError();
        }
        const normalized = skill.toLowerCase();
        if (normalizedSkills.has(normalized)) {
          throw new ProfileCandidateDiscoveryUnavailableError();
        }
        normalizedSkills.add(normalized);
        return skill;
      });
      previousPosition = position;
      seen.add(value.candidateId);
      return {
        candidateId: value.candidateId,
        fullName: value.fullName,
        headline: value.headline,
        skills,
      };
    });
  }

  private isCanonicalEligibility(
    candidates: readonly CandidateDiscoveryEligibility[],
  ): boolean {
    const candidateIds = candidates.map(({ candidateId }) => candidateId);
    const cvIds = candidates.map(({ cvId }) => cvId);
    return candidates.every((candidate) =>
      this.isCanonicalUuid(candidate.candidateId) &&
      this.isCanonicalUuid(candidate.cvId) &&
      this.isVersion(candidate.discoveryVersion) &&
      this.isVersion(candidate.profileVersion)
    ) &&
      candidateIds.every((candidateId, index) =>
        index === 0 || candidateIds[index - 1] < candidateId
      ) &&
      new Set(candidateIds).size === candidateIds.length &&
      new Set(cvIds).size === cvIds.length;
  }

  private isValidResolutionScope(
    candidates: readonly CandidateDiscoveryEligibility[],
  ): boolean {
    const candidateIds = candidates.map(({ candidateId }) => candidateId);
    const cvIds = candidates.map(({ cvId }) => cvId);
    return candidates.every((candidate) =>
      this.isCanonicalUuid(candidate.candidateId) &&
      this.isCanonicalUuid(candidate.cvId) &&
      this.isVersion(candidate.discoveryVersion) &&
      this.isVersion(candidate.profileVersion)
    ) &&
      new Set(candidateIds).size === candidateIds.length &&
      new Set(cvIds).size === cvIds.length;
  }

  private isCanonicalUuid(value: unknown): value is string {
    return isUuidV4(value) && value === value.toLowerCase();
  }

  private isVersion(value: unknown): value is number {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 1 &&
      value <= MAX_VERSION;
  }

  private isCanonicalText(value: unknown, maximum: number): value is string {
    if (
      typeof value !== 'string' ||
      CONTROL_CHARACTER_PATTERN.test(value) ||
      [...value].length < 1 ||
      [...value].length > maximum
    ) {
      return false;
    }
    return value === value.normalize('NFKC')
      .replace(/\p{White_Space}+/gu, ' ')
      .trim();
  }

  private configuredApiKey(): string | undefined {
    const value = this.internalApiKey;
    const byteLength = value ? Buffer.byteLength(value, 'utf8') : 0;
    return value &&
      !value.toLowerCase().includes('replace-with') &&
      byteLength >= 32 &&
      byteLength <= 512 &&
      /^[\x21-\x7e]+$/.test(value)
      ? value
      : undefined;
  }
}
