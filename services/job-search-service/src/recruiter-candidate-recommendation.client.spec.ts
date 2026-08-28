import { ConfigService } from '@nestjs/config';
import {
  AiCandidateRecommendationClientService,
  AiCandidateRecommendationCursorStaleError,
  AiCandidateRecommendationInvalidResponseError,
  AiCandidateRecommendationReason,
  AiCandidateRecommendationUnavailableError,
} from './ai-candidate-recommendation-client.service';
import { CompanyClientService } from './company-client.service';
import {
  CandidateDiscoveryEligibility,
  ProfileCandidateDiscoveryClientService,
  ProfileCandidateDiscoveryUnavailableError,
} from './profile-candidate-discovery-client.service';
import { RecruiterCandidateRecommendationQueryDto } from './recruiter-candidate-recommendation.dto';

const RECRUITER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '44444444-4444-4444-8444-444444444444';
const CANDIDATE_ID_1 = '55555555-5555-4555-8555-555555555555';
const CANDIDATE_ID_2 = '66666666-6666-4666-8666-666666666666';
const CV_ID_1 = '77777777-7777-4777-8777-777777777777';
const CV_ID_2 = '88888888-8888-4888-8888-888888888888';
const AUTHORIZATION = 'Bearer signed.jwt.token';
const PROFILE_KEY = 'profile-job-search-scoped-key-000001';
const AI_JOB_KEY = 'ai-job-recommendation-scoped-key-001';
const AI_CANDIDATE_KEY = 'ai-candidate-ranking-scoped-key-0001';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProfileCandidateDiscoveryClientService', () => {
  it('requests the exact scoped snapshot without forwarding Recruiter JWT',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(profileEnvelope(eligibility())),
    );

    await expect(profileClient().getSnapshot()).resolves.toEqual(eligibility());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://profile:3000/internal/v1/recruiter-discovery/snapshot',
    );
    expect(options).toEqual(expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-internal-api-key': PROFILE_KEY,
        'x-internal-service': 'job-search-service',
      },
    }));
    expect(JSON.parse(options?.body as string)).toEqual({
      schemaVersion: 1,
      purpose: 'RECRUITER_JOB_RECOMMENDATION',
    });
  });

  it('sends exact ranked tuples to resolver and preserves Profile order',
  async () => {
    const ranked = [eligibility()[1], eligibility()[0]];
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(profileEnvelope([
        profile(CANDIDATE_ID_2, 'Senior Engineer'),
        profile(CANDIDATE_ID_1, null),
      ])),
    );

    await expect(profileClient().resolve(ranked)).resolves.toEqual([
      profile(CANDIDATE_ID_2, 'Senior Engineer'),
      profile(CANDIDATE_ID_1, null),
    ]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://profile:3000/internal/v1/recruiter-discovery/resolve',
    );
    expect(JSON.parse(options?.body as string)).toEqual({
      schemaVersion: 1,
      purpose: 'RECRUITER_JOB_RECOMMENDATION',
      candidates: ranked,
    });
    expect(options?.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'x-internal-api-key': PROFILE_KEY,
      'x-internal-service': 'job-search-service',
    });
  });

  it('accepts resolver omissions so the orchestration layer can return 409',
  async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(profileEnvelope([profile(CANDIDATE_ID_2, null)])),
    );

    await expect(profileClient().resolve([
      eligibility()[1],
      eligibility()[0],
    ])).resolves.toEqual([profile(CANDIDATE_ID_2, null)]);
  });

  it.each([
    profileEnvelope([eligibility()[1], eligibility()[0]]),
    profileEnvelope([{ ...eligibility()[0], extra: true }]),
    profileEnvelope([
      eligibility()[0],
      { ...eligibility()[1], cvId: CV_ID_1 },
    ]),
    { ...profileEnvelope(eligibility()), extra: true },
  ])('rejects a malformed discovery snapshot: %j', async (body) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(body),
    );

    await expect(profileClient().getSnapshot())
      .rejects.toBeInstanceOf(ProfileCandidateDiscoveryUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { values: [
      profile(CANDIDATE_ID_1, null),
      profile(CANDIDATE_ID_2, null),
    ] },
    { values: [{ ...profile(CANDIDATE_ID_2, null), phone: 'private' }] },
    {
      values: [profile(
        '99999999-9999-4999-8999-999999999999',
        null,
      )],
    },
    {
      values: [{
        ...profile(CANDIDATE_ID_2, null),
        skills: ['Node.js', 'node.JS'],
      }],
    },
    {
      values: [{
        ...profile(CANDIDATE_ID_2, null),
        fullName: ' Candidate',
      }],
    },
  ])('rejects malformed or out-of-scope resolver output: $values',
  async ({ values }) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(profileEnvelope(values)),
    );

    await expect(profileClient().resolve([
      eligibility()[1],
      eligibility()[0],
    ])).rejects.toBeInstanceOf(ProfileCandidateDiscoveryUnavailableError);
  });

  it.each([
    undefined,
    'short',
    `bad key ${'x'.repeat(32)}`,
    `line\r\n${'x'.repeat(32)}`,
    'replace-with-a-real-profile-key-0001',
    'x'.repeat(513),
  ])('never sends a missing or unsafe Profile key: %j', async (key) => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(profileClient({ PROFILE_INTERNAL_API_KEY: key }).getSnapshot())
      .rejects.toBeInstanceOf(ProfileCandidateDiscoveryUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AiCandidateRecommendationClientService', () => {
  it('posts exact snake_case eligible scope with a distinct scoped key',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(aiEnvelope([
        { candidate_id: CANDIDATE_ID_1, score: 0.9 },
        { candidate_id: CANDIDATE_ID_2, score: 0.9 },
      ], 'next-page', null)),
    );
    const query = {
      limit: 2,
      cursor: 'first-page',
    } as RecruiterCandidateRecommendationQueryDto;

    await expect(aiClient().recommendCandidates(
      JOB_ID,
      7,
      eligibility(),
      query,
    ))
      .resolves.toEqual({
        items: [
          { candidateId: CANDIDATE_ID_1, score: 0.9 },
          { candidateId: CANDIDATE_ID_2, score: 0.9 },
        ],
        nextCursor: 'next-page',
        reason: null,
      });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ai:8000/recommend/candidates');
    expect(options).toEqual(expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-internal-api-key': AI_CANDIDATE_KEY,
        'x-internal-service': 'job-search-service',
      },
    }));
    expect(JSON.parse(options?.body as string)).toEqual({
      job_id: JOB_ID,
      job_version: 7,
      eligible_candidates: [
        {
          candidate_id: CANDIDATE_ID_1,
          cv_id: CV_ID_1,
          discovery_version: 3,
          profile_version: 7,
        },
        {
          candidate_id: CANDIDATE_ID_2,
          cv_id: CV_ID_2,
          discovery_version: 4,
          profile_version: 8,
        },
      ],
      limit: 2,
      cursor: 'first-page',
    });
  });

  it('accepts only a stable reason for an empty AI result', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(aiEnvelope(
      [],
      null,
      AiCandidateRecommendationReason.NO_ACTIVE_CV_EMBEDDINGS,
    )));

    await expect(aiClient().recommendCandidates(
      JOB_ID,
      7,
      eligibility(),
      { limit: 10 } as RecruiterCandidateRecommendationQueryDto,
    )).resolves.toEqual({
      items: [],
      nextCursor: null,
      reason: AiCandidateRecommendationReason.NO_ACTIVE_CV_EMBEDDINGS,
    });
  });

  it.each([
    aiEnvelope([
      { candidate_id: CANDIDATE_ID_2, score: 0.9 },
      { candidate_id: CANDIDATE_ID_1, score: 0.9 },
    ], null, null),
    aiEnvelope([
      { candidate_id: CANDIDATE_ID_1, score: 0.8 },
      { candidate_id: CANDIDATE_ID_2, score: 0.9 },
    ], null, null),
    aiEnvelope([
      {
        candidate_id: '99999999-9999-4999-8999-999999999999',
        score: 0.8,
      },
    ], null, null),
    aiEnvelope([], null, null),
    aiEnvelope(
      [{ candidate_id: CANDIDATE_ID_1, score: 0.8 }],
      null,
      AiCandidateRecommendationReason.NO_MATCHING_CV_EMBEDDINGS,
    ),
    {
      data: {
        ...aiEnvelope([], null, AiCandidateRecommendationReason.JOB_EMBEDDING_NOT_FOUND).data,
        job_id: COMPANY_ID,
      },
      meta: null,
    },
  ])('rejects malformed, unranked or out-of-scope AI output: %j',
  async (body) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(body));

    await expect(aiClient().recommendCandidates(
      JOB_ID,
      7,
      eligibility(),
      { limit: 10 } as RecruiterCandidateRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiCandidateRecommendationInvalidResponseError);
  });

  it('accepts only the strict continuation cursor-stale response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      code: 'RECOMMENDATION_CURSOR_STALE',
      message: 'Recommendation cursor is stale',
      details: null,
    }, 409));

    await expect(aiClient().recommendCandidates(
      JOB_ID,
      7,
      eligibility(),
      { limit: 10, cursor: 'old' } as RecruiterCandidateRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiCandidateRecommendationCursorStaleError);
  });

  it.each([
    [undefined, AI_JOB_KEY],
    ['short', AI_JOB_KEY],
    [AI_JOB_KEY, AI_JOB_KEY],
    [`bad key ${'x'.repeat(32)}`, AI_JOB_KEY],
    ['replace-with-a-real-ai-key-0000001', AI_JOB_KEY],
    ['x'.repeat(513), AI_JOB_KEY],
  ])('never sends a missing, unsafe or reused AI key', async (
    candidateKey,
    jobKey,
  ) => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(aiClient({
      AI_CANDIDATE_INTERNAL_API_KEY: candidateKey,
      AI_INTERNAL_API_KEY: jobKey,
    }).recommendCandidates(
      JOB_ID,
      7,
      eligibility(),
      { limit: 10 } as RecruiterCandidateRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiCandidateRecommendationUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never sends an unsorted or otherwise invalid eligible scope', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(aiClient().recommendCandidates(
      JOB_ID,
      7,
      [eligibility()[1], eligibility()[0]],
      { limit: 10 } as RecruiterCandidateRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiCandidateRecommendationUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, 2_147_483_648, 1.5])(
    'never sends an invalid Job aggregate version: %p',
    async (jobVersion) => {
      const fetchMock = jest.spyOn(global, 'fetch');

      await expect(aiClient().recommendCandidates(
        JOB_ID,
        jobVersion,
        eligibility(),
        { limit: 10 } as RecruiterCandidateRecommendationQueryDto,
      )).rejects.toBeInstanceOf(AiCandidateRecommendationUnavailableError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('Company recommendation authorization client', () => {
  it('uses only the verified Recruiter bearer for strict self-membership',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        data: {
          companyId: COMPANY_ID,
          name: 'Verified Company',
          verifiedStatus: 'VERIFIED',
          memberRole: 'MEMBER',
        },
        meta: null,
      }),
    );

    await expect(companyClient().getRecruiterCompanyForRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
    )).resolves.toEqual({
      companyId: COMPANY_ID,
      name: 'Verified Company',
      verifiedStatus: 'VERIFIED',
      memberRole: 'MEMBER',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://company:3000/by-user/${RECRUITER_ID}`,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: AUTHORIZATION,
        },
      }),
    );
  });

  it('maps malformed self-membership to 503 without trusting fields',
  async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      data: {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'OWNER',
        otherCompanyId: JOB_ID,
      },
      meta: null,
    }));

    await expect(companyClient().getRecruiterCompanyForRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
    )).rejects.toMatchObject({
      code: 'COMPANY_SERVICE_UNAVAILABLE',
    });
  });

  it.each([
    'Bearer not-a-jwt',
    'Bearer  signed.jwt.token',
    'Bearer signed.jwt.token extra',
    'Bearer signed.jwt.token\t',
    `Bearer signed.jwt.token\r\nInjected: true`,
    `Bearer ${'a'.repeat(8_192)}.b.c`,
  ])('never forwards a malformed, duplicate or oversized bearer: %j',
  async (bearer) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(companyClient().getRecruiterCompanyForRecommendation(
      RECRUITER_ID,
      bearer,
    )).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps unsafe recommendation config to 503 without a network call',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(companyClient({
      COMPANY_SERVICE_URL: 'http://external.invalid',
    }).getRecruiterCompanyForRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
    )).rejects.toMatchObject({ code: 'COMPANY_SERVICE_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports Company recommendation URL/allowlist/timeout config locally',
  () => {
    expect(companyClient().isRecommendationConfigured()).toBe(true);
    expect(companyClient({
      COMPANY_SERVICE_URL: 'http://external.invalid',
    }).isRecommendationConfigured()).toBe(false);
    expect(companyClient({
      COMPANY_REQUEST_TIMEOUT_MS: '10001',
    }).isRecommendationConfigured()).toBe(false);
  });
});

function profileClient(
  overrides: Record<string, string | undefined> = {},
): ProfileCandidateDiscoveryClientService {
  return new ProfileCandidateDiscoveryClientService(new ConfigService({
    PROFILE_SERVICE_URL: 'http://profile:3000',
    PROFILE_SERVICE_ALLOWED_HOSTS: 'profile',
    PROFILE_REQUEST_TIMEOUT_MS: '1500',
    PROFILE_INTERNAL_API_KEY: PROFILE_KEY,
    ...overrides,
  }));
}

function aiClient(
  overrides: Record<string, string | undefined> = {},
): AiCandidateRecommendationClientService {
  return new AiCandidateRecommendationClientService(new ConfigService({
    AI_SERVICE_URL: 'http://ai:8000',
    AI_SERVICE_ALLOWED_HOSTS: 'ai',
    AI_REQUEST_TIMEOUT_MS: '1500',
    AI_INTERNAL_API_KEY: AI_JOB_KEY,
    AI_CANDIDATE_INTERNAL_API_KEY: AI_CANDIDATE_KEY,
    ...overrides,
  }));
}

function companyClient(
  overrides: Record<string, string | undefined> = {},
): CompanyClientService {
  return new CompanyClientService(new ConfigService({
    COMPANY_SERVICE_URL: 'http://company:3000',
    COMPANY_SERVICE_ALLOWED_HOSTS: 'company',
    COMPANY_REQUEST_TIMEOUT_MS: '1500',
    ...overrides,
  }));
}

function eligibility(): CandidateDiscoveryEligibility[] {
  return [
    {
      candidateId: CANDIDATE_ID_1,
      cvId: CV_ID_1,
      discoveryVersion: 3,
      profileVersion: 7,
    },
    {
      candidateId: CANDIDATE_ID_2,
      cvId: CV_ID_2,
      discoveryVersion: 4,
      profileVersion: 8,
    },
  ];
}

function profile(candidateId: string, headline: string | null) {
  return {
    candidateId,
    fullName: `Candidate ${candidateId.slice(0, 4)}`,
    headline,
    skills: ['TypeScript', 'PostgreSQL'],
  };
}

function profileEnvelope(candidates: unknown[]) {
  return {
    data: {
      schemaVersion: 1,
      purpose: 'RECRUITER_JOB_RECOMMENDATION',
      candidates,
    },
    meta: null,
  };
}

function aiEnvelope(
  items: Array<{ candidate_id: string; score: number }>,
  nextCursor: string | null,
  reason: AiCandidateRecommendationReason | null,
) {
  return {
    data: {
      job_id: JOB_ID,
      items,
      next_cursor: nextCursor,
      reason,
    },
    meta: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
