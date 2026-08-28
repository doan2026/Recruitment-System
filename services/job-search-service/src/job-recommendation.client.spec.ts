import { ConfigService } from '@nestjs/config';
import { JobType } from '@prisma/client';
import {
  AiRecommendationClientService,
  AiRecommendationCursorStaleError,
  AiRecommendationInvalidResponseError,
  AiRecommendationReason,
  AiRecommendationUnavailableError,
} from './ai-recommendation-client.service';
import { JobRecommendationQueryDto } from './job-recommendation.dto';
import {
  JobPreferenceState,
  ProfileRecommendationClientService,
  ProfileRecommendationUnavailableError,
} from './profile-recommendation-client.service';
import { RECOMMENDATION_RESPONSE_MAX_BYTES } from './recommendation-http';

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const DEFAULT_CV_ID = '22222222-2222-4222-8222-222222222222';
const LATEST_CV_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID_1 = '55555555-5555-4555-8555-555555555555';
const JOB_ID_2 = '66666666-6666-4666-8666-666666666666';
const AUTHORIZATION = 'Bearer signed.jwt.token';
const AI_KEY = 'job-search-scoped-secret-00000001';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProfileRecommendationClientService', () => {
  it('forwards only the Candidate JWT and selects the default Media-backed CV',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope([
        cv(LATEST_CV_ID, false, '2026-08-28T00:00:00.000Z'),
        cv(DEFAULT_CV_ID, true, '2026-08-01T00:00:00.000Z'),
      ])),
    );
    const client = profileClient();

    await expect(client.getPreferredCv(CANDIDATE_ID, AUTHORIZATION))
      .resolves.toEqual({ cvId: DEFAULT_CV_ID });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://profile:3000/cvs',
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

  it('selects newest then UUID when a legacy response has no default', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(envelope([
      cv(DEFAULT_CV_ID, false, '2026-08-28T00:00:00.000Z'),
      cv(LATEST_CV_ID, false, '2026-08-28T00:00:00.000Z'),
    ])));

    await expect(profileClient().getPreferredCv(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).resolves.toEqual({ cvId: DEFAULT_CV_ID });
  });

  it('returns null for an empty active CV list', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope([])),
    );

    await expect(profileClient().getPreferredCv(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).resolves.toBeNull();
  });

  it.each([
    envelope([
      cv(DEFAULT_CV_ID, true, '2026-08-01T00:00:00.000Z'),
      cv(LATEST_CV_ID, true, '2026-08-02T00:00:00.000Z'),
    ]),
    envelope([{
      ...cv(DEFAULT_CV_ID, true, '2026-08-01T00:00:00.000Z'),
      userId: LATEST_CV_ID,
    }]),
    envelope([{
      ...cv(DEFAULT_CV_ID, true, '2026-08-01T00:00:00.000Z'),
      fileUrl: 'https://public.invalid/cv.pdf',
    }]),
    envelope([{
      ...cv(DEFAULT_CV_ID, true, '2026-08-01T00:00:00.000Z'),
      createdAt: '0',
    }]),
    { data: [], meta: null, extra: true },
  ])('rejects an invalid Profile contract without leaking it: %j',
  async (body) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(body),
    );

    await expect(profileClient().getPreferredCv(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).rejects.toBeInstanceOf(ProfileRecommendationUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not follow redirects and does not retry Profile failures',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } }),
    );

    await expect(profileClient().getPreferredCv(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).rejects.toBeInstanceOf(ProfileRecommendationUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it.each([
    'Bearer one.two',
    'Bearer  one.two.three',
    'Bearer one.two.three\t',
    `Bearer one.two.three${String.fromCharCode(0)}`,
  ])('never forwards a malformed Candidate bearer header: %j',
  async (authorization) => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(profileClient().getPreferredCv(
      CANDIDATE_ID,
      authorization,
    )).rejects.toBeInstanceOf(ProfileRecommendationUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the exact Candidate preference projection without another identity',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope(enabledPreferences())),
    );

    await expect(profileClient().getJobPreferences(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).resolves.toEqual({
      ...enabledPreferences(),
      state: JobPreferenceState.ENABLED,
      targetRoles: ['Backend Engineer'],
      preferredLocations: ['Ha Noi'],
      preferredJobTypes: [JobType.FULL_TIME],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://profile:3000/job-preferences',
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

  it('accepts exactly the four job types defined by preference schema v1',
  async () => {
    const data = {
      ...enabledPreferences(),
      preferredJobTypes: [
        JobType.FULL_TIME,
        JobType.PART_TIME,
        JobType.REMOTE,
        JobType.INTERNSHIP,
      ],
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope(data)),
    );

    await expect(profileClient().getJobPreferences(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).resolves.toMatchObject({
      preferredJobTypes: data.preferredJobTypes,
    });
  });

  it.each([
    unsetPreferences(),
    disabledPreferences(),
  ])('accepts a strictly redacted $state projection', async (preference) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope(preference)),
    );

    await expect(profileClient().getJobPreferences(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).resolves.toMatchObject({
      state: preference.state,
      targetRoles: [],
      preferredLocations: [],
      preferredJobTypes: [],
      minimumSalary: null,
    });
  });

  it.each([
    { ...enabledPreferences(), extra: true },
    { ...enabledPreferences(), candidateId: LATEST_CV_ID },
    { ...enabledPreferences(), schemaVersion: 2 },
    { ...enabledPreferences(), version: 0 },
    { ...enabledPreferences(), consentVersion: null },
    { ...enabledPreferences(), consentedAt: null },
    { ...enabledPreferences(), withdrawnAt: '2026-08-28T00:30:00.000Z' },
    {
      ...enabledPreferences(),
      targetRoles: ['Backend Engineer', 'backend engineer'],
    },
    { ...enabledPreferences(), targetRoles: [' Backend Engineer'] },
    { ...enabledPreferences(), preferredLocations: Array(6).fill('Ha Noi') },
    { ...enabledPreferences(), preferredJobTypes: ['CONTRACT'] },
    { ...enabledPreferences(), minimumSalary: '20000000' },
    { ...enabledPreferences(), minimumSalary: '0.00' },
    { ...enabledPreferences(), minimumSalary: '10000000000000.00' },
    {
      ...enabledPreferences(),
      targetRoles: [],
      preferredLocations: [],
      preferredJobTypes: [],
      minimumSalary: null,
    },
    { ...enabledPreferences(), consentedAt: '2026-08-28T02:00:00.000Z' },
    { ...disabledPreferences(), targetRoles: ['Backend Engineer'] },
    { ...disabledPreferences(), withdrawnAt: null },
    { ...unsetPreferences(), version: 1 },
    { ...unsetPreferences(), createdAt: '2026-08-28T00:00:00.000Z' },
  ])('rejects a contradictory preference projection: %j', async (data) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope(data)),
    );

    await expect(profileClient().getJobPreferences(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).rejects.toBeInstanceOf(ProfileRecommendationUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'percent ILIKE metacharacter',
      { ...enabledPreferences(), targetRoles: ['Backend%Engineer'] },
    ],
    [
      'underscore ILIKE metacharacter',
      { ...enabledPreferences(), preferredLocations: ['Ha_Noi'] },
    ],
    [
      'backslash ILIKE escape',
      { ...enabledPreferences(), targetRoles: ['Backend\\Engineer'] },
    ],
    [
      'unpaired high surrogate',
      {
        ...enabledPreferences(),
        targetRoles: [`Backend${String.fromCharCode(0xd800)}Engineer`],
      },
    ],
    [
      'unpaired low surrogate',
      {
        ...enabledPreferences(),
        preferredLocations: [`Ha${String.fromCharCode(0xdc00)}Noi`],
      },
    ],
    [
      'PostgreSQL zero byte',
      {
        ...enabledPreferences(),
        preferredLocations: [`Ha${String.fromCharCode(0)}Noi`],
      },
    ],
  ])('rejects PostgreSQL-unsafe preference text: %s', async (_case, data) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope(data)),
    );

    await expect(profileClient().getJobPreferences(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).rejects.toBeInstanceOf(ProfileRecommendationUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a paired supplementary Unicode scalar in preference text',
  async () => {
    const data = {
      ...enabledPreferences(),
      targetRoles: ['Backend 🚀 Engineer'],
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(envelope(data)),
    );

    await expect(profileClient().getJobPreferences(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).resolves.toMatchObject({ targetRoles: data.targetRoles });
  });

  it('does not follow redirects or retry a preference failure', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://evil.invalid' },
      }),
    );

    await expect(profileClient().getJobPreferences(
      CANDIDATE_ID,
      AUTHORIZATION,
    )).rejects.toBeInstanceOf(ProfileRecommendationUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
});

describe('AiRecommendationClientService', () => {
  it('sends the exact scoped request and accepts strict ranked output',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(aiEnvelope([
        { job_id: JOB_ID_1, score: 0.9 },
        { job_id: JOB_ID_2, score: 0.9 },
      ], 'cursor-2', null)),
    );
    const query = {
      limit: 2,
      cursor: 'cursor-1',
      location: 'Ha Noi',
      salaryMin: 20_000_000,
      jobType: JobType.FULL_TIME,
    } as JobRecommendationQueryDto;

    await expect(aiClient().recommendJobs(DEFAULT_CV_ID, query))
      .resolves.toEqual({
        items: [
          { jobId: JOB_ID_1, score: 0.9 },
          { jobId: JOB_ID_2, score: 0.9 },
        ],
        nextCursor: 'cursor-2',
        reason: null,
      });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ai:8000/recommend/jobs');
    expect(options).toEqual(expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-internal-api-key': AI_KEY,
        'x-internal-service': 'job-search-service',
      },
    }));
    expect(JSON.parse(options?.body as string)).toEqual({
      cv_id: DEFAULT_CV_ID,
      limit: 2,
      cursor: 'cursor-1',
      location: 'Ha Noi',
      salary_min: 20_000_000,
      job_type: JobType.FULL_TIME,
    });
  });

  it('accepts only the stable empty-result reasons', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(
      aiEnvelope([], null, AiRecommendationReason.CV_EMBEDDING_INACTIVE),
    ));

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).resolves.toEqual({
      items: [],
      nextCursor: null,
      reason: AiRecommendationReason.CV_EMBEDDING_INACTIVE,
    });
  });

  it('accepts reverse UUID order when displayed float scores are equal',
  async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(aiEnvelope([
      { job_id: JOB_ID_2, score: 0.8 },
      { job_id: JOB_ID_1, score: 0.8 },
    ], null, null)));

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).resolves.toMatchObject({
      items: [
        { jobId: JOB_ID_2, score: 0.8 },
        { jobId: JOB_ID_1, score: 0.8 },
      ],
    });
  });

  it.each([
    aiEnvelope([{ job_id: JOB_ID_1, score: 1.01 }], null, null),
    aiEnvelope([
      { job_id: JOB_ID_2, score: 0.8 },
      { job_id: JOB_ID_1, score: 0.9 },
    ], null, null),
    aiEnvelope([
      { job_id: JOB_ID_1, score: 0.8 },
      { job_id: JOB_ID_1, score: 0.7 },
    ], null, null),
    aiEnvelope(
      [{ job_id: JOB_ID_1, score: 0.8 }],
      null,
      AiRecommendationReason.CV_EMBEDDING_NOT_FOUND,
    ),
    aiEnvelope(
      [],
      'must-not-exist',
      AiRecommendationReason.CV_EMBEDDING_NOT_FOUND,
    ),
    aiEnvelope([], null, null),
    aiEnvelope([], 'must-not-exist', null),
    {
      ...aiEnvelope([], null, null),
      extra: true,
    },
    {
      data: {
        ...aiEnvelope([], null, null).data,
        cv_id: LATEST_CV_ID,
      },
      meta: null,
    },
  ])('rejects malformed or contradictory AI output: %j', async (body) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(body),
    );

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationInvalidResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects non-JSON and oversized success responses', async () => {
    const nonJson = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationInvalidResponseError);
    expect(nonJson).toHaveBeenCalledTimes(1);

    nonJson.mockResolvedValueOnce(new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(RECOMMENDATION_RESPONSE_MAX_BYTES + 1),
      },
    }));
    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationInvalidResponseError);
  });

  it('does not follow redirects or retry unavailable AI calls', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 307, headers: { location: 'https://evil.invalid' } }),
    );

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('accepts only the strict stable AI cursor-stale error', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        code: 'RECOMMENDATION_CURSOR_STALE',
        message: 'Recommendation cursor is stale',
        details: null,
      }, 409),
    );

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10, cursor: 'old-cursor' } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationCursorStaleError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an exact cursor-stale 409 on page one as invalid upstream',
  async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        code: 'RECOMMENDATION_CURSOR_STALE',
        message: 'Recommendation cursor is stale',
        details: null,
      }, 409),
    );

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationInvalidResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      code: 'RECOMMENDATION_CURSOR_STALE',
      message: 'Recommendation cursor is stale',
      details: {},
    },
    {
      code: 'SOMETHING_ELSE',
      message: 'Recommendation cursor is stale',
      details: null,
    },
    {
      code: 'RECOMMENDATION_CURSOR_STALE',
      message: 'Recommendation cursor is stale',
      details: null,
      extra: true,
    },
  ])('rejects a malformed AI 409 contract: %j', async (body) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(body, 409),
    );

    await expect(aiClient().recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10, cursor: 'old-cursor' } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationInvalidResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    '',
    'line-one\r\nInjected: true',
    `key-with-tab\t${'x'.repeat(32)}`,
    `key-with-nul${String.fromCharCode(0)}${'x'.repeat(32)}`,
    `key with internal space ${'x'.repeat(32)}`,
    'é'.repeat(16),
    'short-key',
    ' leading-whitespace-is-not-a-key-0001',
    'trailing-whitespace-is-not-a-key-0001 ',
    'é'.repeat(257),
    'x'.repeat(513),
  ])('never sends a missing or unsafe scoped key', async (key) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const client = aiClient({ AI_INTERNAL_API_KEY: key });

    await expect(client.recommendJobs(
      DEFAULT_CV_ID,
      { limit: 10 } as JobRecommendationQueryDto,
    )).rejects.toBeInstanceOf(AiRecommendationUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('recommendation outbound environment', () => {
  it.each([
    ['PROFILE_REQUEST_TIMEOUT_MS', '99'],
    ['PROFILE_REQUEST_TIMEOUT_MS', '10001'],
    ['AI_REQUEST_TIMEOUT_MS', '1.5'],
    ['AI_REQUEST_TIMEOUT_MS', 'invalid'],
  ])('fails startup for an unsafe %s value', (key, value) => {
    const config = new ConfigService({ [key]: value });
    const create = key.startsWith('PROFILE')
      ? () => new ProfileRecommendationClientService(config)
      : () => new AiRecommendationClientService(config);
    expect(create).toThrow('must be an integer between 100 and 10000');
  });

  it.each([
    ['PROFILE_SERVICE_URL', 'file:///tmp/profile'],
    ['AI_SERVICE_URL', 'http://secret@example.invalid'],
    ['AI_SERVICE_URL', 'not-a-url'],
    ['PROFILE_SERVICE_URL', 'http://profile:3000/private'],
  ])('fails startup for an unsafe %s', (key, value) => {
    const config = new ConfigService({
      [key]: value,
      PROFILE_SERVICE_ALLOWED_HOSTS: 'profile',
      AI_SERVICE_ALLOWED_HOSTS: 'example.invalid',
    });
    const create = key.startsWith('PROFILE')
      ? () => new ProfileRecommendationClientService(config)
      : () => new AiRecommendationClientService(config);
    expect(create).toThrow('must be an absolute root HTTP URL');
  });

  it('rejects an external host unless it is explicitly allowlisted', () => {
    expect(() => new ProfileRecommendationClientService(new ConfigService({
      PROFILE_SERVICE_URL: 'https://profile.internal.example:8443',
    }))).toThrow(
      'PROFILE_SERVICE_URL host is not allowed by ' +
      'PROFILE_SERVICE_ALLOWED_HOSTS',
    );
    expect(() => new AiRecommendationClientService(new ConfigService({
      AI_SERVICE_URL: 'https://ai.internal.example',
      AI_SERVICE_ALLOWED_HOSTS: 'ai.internal.example',
    }))).not.toThrow();
  });

  it.each([
    '',
    'ai-service,',
    'ai-service:8000',
    'https://ai-service',
  ])('rejects an unsafe outbound host allowlist: %j', (allowedHosts) => {
    expect(() => new AiRecommendationClientService(new ConfigService({
      AI_SERVICE_ALLOWED_HOSTS: allowedHosts,
    }))).toThrow(
      'AI_SERVICE_ALLOWED_HOSTS must contain comma-separated normalized hosts',
    );
  });
});

function profileClient(
  overrides: Record<string, string | undefined> = {},
): ProfileRecommendationClientService {
  return new ProfileRecommendationClientService(new ConfigService({
    PROFILE_SERVICE_URL: 'http://profile:3000',
    PROFILE_SERVICE_ALLOWED_HOSTS: 'profile',
    PROFILE_REQUEST_TIMEOUT_MS: '1500',
    ...overrides,
  }));
}

function aiClient(
  overrides: Record<string, string | undefined> = {},
): AiRecommendationClientService {
  return new AiRecommendationClientService(new ConfigService({
    AI_SERVICE_URL: 'http://ai:8000',
    AI_SERVICE_ALLOWED_HOSTS: 'ai',
    AI_REQUEST_TIMEOUT_MS: '1500',
    AI_INTERNAL_API_KEY: AI_KEY,
    ...overrides,
  }));
}

function envelope(data: unknown) {
  return { data, meta: null };
}

function cv(id: string, isDefault: boolean, createdAt: string) {
  return {
    id,
    userId: CANDIDATE_ID,
    type: 'UPLOAD',
    fileId: FILE_ID,
    fileUrl: null,
    isDefault,
    createdAt,
  };
}

function enabledPreferences() {
  return {
    schemaVersion: 1,
    candidateId: CANDIDATE_ID,
    state: 'ENABLED',
    version: 3,
    consentVersion: 1,
    consentedAt: '2026-08-28T00:00:00.000Z',
    withdrawnAt: null,
    targetRoles: ['Backend Engineer'],
    preferredLocations: ['Ha Noi'],
    preferredJobTypes: [JobType.FULL_TIME],
    minimumSalary: '20000000.00',
    currency: 'VND',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T01:00:00.000Z',
  };
}

function unsetPreferences() {
  return {
    schemaVersion: 1,
    candidateId: CANDIDATE_ID,
    state: 'UNSET',
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

function disabledPreferences() {
  return {
    ...unsetPreferences(),
    state: 'DISABLED',
    version: 4,
    consentedAt: '2026-08-28T00:00:00.000Z',
    withdrawnAt: '2026-08-28T02:00:00.000Z',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T03:00:00.000Z',
  };
}

function aiEnvelope(
  items: Array<{ job_id: string; score: number }>,
  nextCursor: string | null,
  reason: AiRecommendationReason | null,
) {
  return {
    data: {
      cv_id: DEFAULT_CV_ID,
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
