import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import {
  AiRecommendationClientService,
  AiRecommendationCursorStaleError,
  AiRecommendationInvalidResponseError,
  AiRecommendationReason,
  AiRecommendationUnavailableError,
} from './ai-recommendation-client.service';
import { ApiException } from './common';
import {
  JobRecommendationFallbackReason,
  JobRecommendationQueryDto,
  JobRecommendationSource,
} from './job-recommendation.dto';
import { JobRecommendationService } from './job-recommendation.service';
import {
  JobPreferenceState,
  ProfileRecommendationClientService,
  ProfileRecommendationUnavailableError,
} from './profile-recommendation-client.service';
import { PrismaService } from './prisma.service';

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const CV_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID_1 = '33333333-3333-4333-8333-333333333333';
const JOB_ID_2 = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-28T18:00:00.000Z');
const TODAY = new Date('2026-08-28T00:00:00.000Z');
const PUBLIC_CARD_SELECT = {
  id: true,
  companyId: true,
  title: true,
  description: true,
  salaryMin: true,
  salaryMax: true,
  isNegotiable: true,
  currency: true,
  location: true,
  jobType: true,
  experienceYears: true,
  skills: true,
  deadline: true,
  publishedAt: true,
};

describe('JobRecommendationService', () => {
  let findMany: jest.Mock;
  let getPreferredCv: jest.Mock;
  let getJobPreferences: jest.Mock;
  let recommendJobs: jest.Mock;
  let transaction: jest.Mock;
  let service: JobRecommendationService;

  beforeEach(() => {
    findMany = jest.fn();
    getPreferredCv = jest.fn().mockResolvedValue({ cvId: CV_ID });
    getJobPreferences = jest.fn().mockResolvedValue(unsetPreferences());
    recommendJobs = jest.fn();
    transaction = jest.fn(async (operation) => operation({
      job: { findMany },
    }));
    service = new JobRecommendationService(
      {
        job: { findMany },
        $transaction: transaction,
      } as unknown as PrismaService,
      {
        getPreferredCv,
        getJobPreferences,
      } as unknown as ProfileRecommendationClientService,
      { recommendJobs } as unknown as AiRecommendationClientService,
    );
  });

  it('revalidates once with authoritative filters and restores AI order',
  async () => {
    recommendJobs.mockResolvedValue({
      items: [
        { jobId: JOB_ID_2, score: 0.91 },
        { jobId: JOB_ID_1, score: 0.81 },
      ],
      nextCursor: 'next-page',
      reason: null,
    });
    findMany.mockResolvedValue([
      job(JOB_ID_1, { title: 'Lower ranked' }),
      job(JOB_ID_2, { title: 'Higher ranked' }),
    ]);
    const query = {
      limit: 2,
      location: 'Ha Noi',
      salaryMin: 20_000_000,
      jobType: JobType.FULL_TIME,
    } as JobRecommendationQueryDto;

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      query,
      NOW,
    );

    expect(getPreferredCv).toHaveBeenCalledWith(
      CANDIDATE_ID,
      'Bearer token',
    );
    expect(getJobPreferences).not.toHaveBeenCalled();
    expect(recommendJobs).toHaveBeenCalledWith(CV_ID, query);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      select: PUBLIC_CARD_SELECT,
      where: {
        status: JobStatus.PUBLISHED,
        deadline: { gte: TODAY },
        location: {
          equals: 'Ha Noi',
          mode: Prisma.QueryMode.insensitive,
        },
        OR: [
          { isNegotiable: true },
          { salaryMax: { gte: 20_000_000 } },
        ],
        jobType: JobType.FULL_TIME,
        id: { in: [JOB_ID_2, JOB_ID_1] },
      },
    });
    expect(result).toMatchObject({
      source: JobRecommendationSource.AI,
      fallbackReason: null,
      nextCursor: 'next-page',
    });
    expect(result.items.map(({ id, score }) => ({ id, score }))).toEqual([
      { id: JOB_ID_2, score: 0.91 },
      { id: JOB_ID_1, score: 0.81 },
    ]);
    expect(result.items[0]).not.toHaveProperty('createdBy');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('createdBy');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('requirements');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('benefits');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('reviewedBy');
    expect(result.items[0]).not.toHaveProperty('reviewedBy');
  });

  it('keeps the valid AI subset without running a fill query', async () => {
    recommendJobs.mockResolvedValue({
      items: [
        { jobId: JOB_ID_1, score: 0.9 },
        { jobId: JOB_ID_2, score: 0.8 },
      ],
      nextCursor: 'next',
      reason: null,
    });
    findMany.mockResolvedValue([job(JOB_ID_2)]);

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10 } as JobRecommendationQueryDto,
      NOW,
    );

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(JobRecommendationSource.AI);
    expect(result.items.map(({ id }) => id)).toEqual([JOB_ID_2]);
    expect(result.nextCursor).toBe('next');
  });

  it('falls back to deterministic latest jobs when every AI id is stale',
  async () => {
    recommendJobs.mockResolvedValue({
      items: [{ jobId: JOB_ID_1, score: 0.9 }],
      nextCursor: 'ignored',
      reason: null,
    });
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([job(JOB_ID_2)]);

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 4 } as JobRecommendationQueryDto,
      NOW,
    );

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0]).toEqual({
      select: PUBLIC_CARD_SELECT,
      where: {
        status: JobStatus.PUBLISHED,
        deadline: { gte: TODAY },
      },
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take: 4,
    });
    expect(result).toMatchObject({
      source: JobRecommendationSource.LATEST,
      fallbackReason: JobRecommendationFallbackReason.AI_RESULTS_STALE,
      nextCursor: null,
    });
    expect(result.items[0].score).toBeNull();
  });

  it.each([
    {
      prepare: (
        profile: jest.Mock,
        _ai: jest.Mock,
      ) => profile.mockResolvedValue(null),
      reason: JobRecommendationFallbackReason.NO_ACTIVE_CV,
      aiCalls: 0,
    },
    {
      prepare: (
        profile: jest.Mock,
        _ai: jest.Mock,
      ) => profile.mockRejectedValue(
        new ProfileRecommendationUnavailableError(),
      ),
      reason: JobRecommendationFallbackReason.PROFILE_UNAVAILABLE,
      aiCalls: 0,
    },
    {
      prepare: (
        _profile: jest.Mock,
        ai: jest.Mock,
      ) => ai.mockRejectedValue(new AiRecommendationUnavailableError()),
      reason: JobRecommendationFallbackReason.AI_UNAVAILABLE,
      aiCalls: 1,
    },
    {
      prepare: (
        _profile: jest.Mock,
        ai: jest.Mock,
      ) => ai.mockRejectedValue(new AiRecommendationCursorStaleError()),
      reason: JobRecommendationFallbackReason.AI_RESPONSE_INVALID,
      aiCalls: 1,
    },
    {
      prepare: (
        _profile: jest.Mock,
        ai: jest.Mock,
      ) => ai.mockResolvedValue({
        items: [],
        nextCursor: null,
        reason: null,
      }),
      reason: JobRecommendationFallbackReason.AI_RESPONSE_INVALID,
      aiCalls: 1,
    },
    {
      prepare: (
        _profile: jest.Mock,
        ai: jest.Mock,
      ) => ai.mockRejectedValue(
        new AiRecommendationInvalidResponseError(),
      ),
      reason: JobRecommendationFallbackReason.AI_RESPONSE_INVALID,
      aiCalls: 1,
    },
    {
      prepare: (
        _profile: jest.Mock,
        ai: jest.Mock,
      ) => ai.mockResolvedValue({
        items: [],
        nextCursor: null,
        reason: AiRecommendationReason.CV_EMBEDDING_NOT_FOUND,
      }),
      reason: JobRecommendationFallbackReason.AI_NOT_READY,
      aiCalls: 1,
    },
  ])('uses one latest query for fail-soft reason $reason',
  async ({ prepare, reason, aiCalls }) => {
    prepare(getPreferredCv, recommendJobs);
    findMany.mockResolvedValue([job(JOB_ID_1)]);

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10 } as JobRecommendationQueryDto,
      NOW,
    );

    expect(recommendJobs).toHaveBeenCalledTimes(aiCalls);
    expect(getJobPreferences).toHaveBeenCalledWith(
      CANDIDATE_ID,
      'Bearer token',
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(JobRecommendationSource.LATEST);
    expect(result.fallbackReason).toBe(reason);
    expect(result.items[0].score).toBeNull();
  });

  it('returns preference matches first and fills the page without duplicates',
  async () => {
    getPreferredCv.mockResolvedValue(null);
    getJobPreferences.mockResolvedValue(enabledPreferences());
    findMany
      .mockResolvedValueOnce([job(JOB_ID_1)])
      .mockResolvedValueOnce([job(JOB_ID_2)]);

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 2 } as JobRecommendationQueryDto,
      NOW,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0]).toEqual({
      select: PUBLIC_CARD_SELECT,
      where: {
        AND: [
          {
            status: JobStatus.PUBLISHED,
            deadline: { gte: TODAY },
          },
          {
            OR: [
              {
                title: {
                  equals: 'Backend Engineer',
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                location: {
                  equals: 'Ha Noi',
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              { jobType: { in: [JobType.FULL_TIME] } },
              {
                OR: [
                  { isNegotiable: true },
                  {
                    currency: 'VND',
                    salaryMax: { gte: new Prisma.Decimal('20000000.00') },
                  },
                ],
              },
            ],
          },
        ],
      },
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take: 2,
    });
    expect(findMany.mock.calls[1][0]).toEqual({
      select: PUBLIC_CARD_SELECT,
      where: {
        AND: [
          {
            status: JobStatus.PUBLISHED,
            deadline: { gte: TODAY },
          },
          { id: { notIn: [JOB_ID_1] } },
        ],
      },
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take: 1,
    });
    expect(result).toMatchObject({
      source: JobRecommendationSource.PREFERENCES,
      fallbackReason: JobRecommendationFallbackReason.NO_ACTIVE_CV,
      nextCursor: null,
    });
    expect(result.items.map(({ id, score }) => ({ id, score }))).toEqual([
      { id: JOB_ID_1, score: null },
      { id: JOB_ID_2, score: null },
    ]);
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('createdBy');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('requirements');
  });

  it('keeps request filters hard and ignores stored values in those dimensions',
  async () => {
    getPreferredCv.mockResolvedValue(null);
    getJobPreferences.mockResolvedValue(enabledPreferences());
    findMany.mockResolvedValue([job(JOB_ID_1)]);
    const query = {
      limit: 1,
      location: 'Da Nang',
      salaryMin: 35_000_000,
      jobType: JobType.REMOTE,
    } as JobRecommendationQueryDto;

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      query,
      NOW,
    );

    expect(findMany.mock.calls[0][0].where).toEqual({
      AND: [
        {
          status: JobStatus.PUBLISHED,
          deadline: { gte: TODAY },
          location: {
            equals: 'Da Nang',
            mode: Prisma.QueryMode.insensitive,
          },
          OR: [
            { isNegotiable: true },
            { salaryMax: { gte: 35_000_000 } },
          ],
          jobType: JobType.REMOTE,
        },
        {
          OR: [{
            title: {
              equals: 'Backend Engineer',
              mode: Prisma.QueryMode.insensitive,
            },
          }],
        },
      ],
    });
    expect(result.source).toBe(JobRecommendationSource.PREFERENCES);
  });

  it('uses latest when request filters override every stored criterion',
  async () => {
    getPreferredCv.mockResolvedValue(null);
    getJobPreferences.mockResolvedValue(enabledPreferences({
      targetRoles: [],
      minimumSalary: null,
    }));
    findMany.mockResolvedValue([job(JOB_ID_1)]);

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      {
        limit: 10,
        location: 'Da Nang',
        jobType: JobType.REMOTE,
      } as JobRecommendationQueryDto,
      NOW,
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(JobRecommendationSource.LATEST);
  });

  it('returns latest from the same snapshot when no job matches preferences',
  async () => {
    getPreferredCv.mockResolvedValue(null);
    getJobPreferences.mockResolvedValue(enabledPreferences({
      preferredLocations: [],
      preferredJobTypes: [],
      minimumSalary: null,
    }));
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([job(JOB_ID_2)]);

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10 } as JobRecommendationQueryDto,
      NOW,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(result.source).toBe(JobRecommendationSource.LATEST);
    expect(result.items.map(({ id }) => id)).toEqual([JOB_ID_2]);
  });

  it('fails soft to latest when the preference contract is unavailable',
  async () => {
    getPreferredCv.mockResolvedValue(null);
    getJobPreferences.mockRejectedValue(
      new ProfileRecommendationUnavailableError(),
    );
    findMany.mockResolvedValue([job(JOB_ID_1)]);

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10 } as JobRecommendationQueryDto,
      NOW,
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: JobRecommendationSource.LATEST,
      fallbackReason: JobRecommendationFallbackReason.NO_ACTIVE_CV,
    });
  });

  it('does not hide PostgreSQL failures behind a fallback', async () => {
    getPreferredCv.mockResolvedValue(null);
    findMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10 } as JobRecommendationQueryDto,
      NOW,
    )).rejects.toThrow('database unavailable');
  });

  it('does not hide unexpected dependency programming errors', async () => {
    getPreferredCv.mockRejectedValue(new TypeError('contract bug'));

    await expect(service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10 } as JobRecommendationQueryDto,
      NOW,
    )).rejects.toThrow('contract bug');
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      prepare: (profile: jest.Mock, _ai: jest.Mock) =>
        profile.mockResolvedValue(null),
      code: 'RECOMMENDATION_CURSOR_STALE',
      status: 409,
      aiCalls: 0,
    },
    {
      prepare: (profile: jest.Mock, _ai: jest.Mock) =>
        profile.mockRejectedValue(
          new ProfileRecommendationUnavailableError(),
        ),
      code: 'RECOMMENDATION_UNAVAILABLE',
      status: 503,
      aiCalls: 0,
    },
    {
      prepare: (_profile: jest.Mock, ai: jest.Mock) =>
        ai.mockRejectedValue(new AiRecommendationCursorStaleError()),
      code: 'RECOMMENDATION_CURSOR_STALE',
      status: 409,
      aiCalls: 1,
    },
    {
      prepare: (_profile: jest.Mock, ai: jest.Mock) =>
        ai.mockRejectedValue(new AiRecommendationUnavailableError()),
      code: 'RECOMMENDATION_UNAVAILABLE',
      status: 503,
      aiCalls: 1,
    },
    {
      prepare: (_profile: jest.Mock, ai: jest.Mock) =>
        ai.mockRejectedValue(new AiRecommendationInvalidResponseError()),
      code: 'RECOMMENDATION_UNAVAILABLE',
      status: 503,
      aiCalls: 1,
    },
    {
      prepare: (_profile: jest.Mock, ai: jest.Mock) =>
        ai.mockResolvedValue({
          items: [],
          nextCursor: null,
          reason: AiRecommendationReason.NO_ACTIVE_JOB_EMBEDDINGS,
        }),
      code: 'RECOMMENDATION_CURSOR_STALE',
      status: 409,
      aiCalls: 1,
    },
    {
      prepare: (_profile: jest.Mock, ai: jest.Mock) =>
        ai.mockResolvedValue({
          items: [],
          nextCursor: null,
          reason: null,
        }),
      code: 'RECOMMENDATION_UNAVAILABLE',
      status: 503,
      aiCalls: 1,
    },
  ])('never mixes a continuation page with latest jobs: $code',
  async ({ prepare, code, status, aiCalls }) => {
    prepare(getPreferredCv, recommendJobs);

    const result = service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10, cursor: 'page-2' } as JobRecommendationQueryDto,
      NOW,
    );

    await expect(result).rejects.toBeInstanceOf(ApiException);
    await expect(result).rejects.toMatchObject({ code, status });
    expect(recommendJobs).toHaveBeenCalledTimes(aiCalls);
    expect(getJobPreferences).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns cursor stale without a latest query when all page ids are stale',
  async () => {
    recommendJobs.mockResolvedValue({
      items: [{ jobId: JOB_ID_1, score: 0.9 }],
      nextCursor: 'next',
      reason: null,
    });
    findMany.mockResolvedValue([]);

    const result = service.recommend(
      CANDIDATE_ID,
      'Bearer token',
      { limit: 10, cursor: 'page-2' } as JobRecommendationQueryDto,
      NOW,
    );

    await expect(result).rejects.toBeInstanceOf(ApiException);
    await expect(result).rejects.toMatchObject({
      code: 'RECOMMENDATION_CURSOR_STALE',
    });
    expect(getJobPreferences).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

function unsetPreferences() {
  return {
    schemaVersion: 1 as const,
    candidateId: CANDIDATE_ID,
    state: JobPreferenceState.UNSET,
    version: 0,
    consentVersion: null,
    consentedAt: null,
    withdrawnAt: null,
    targetRoles: [],
    preferredLocations: [],
    preferredJobTypes: [],
    minimumSalary: null,
    currency: 'VND' as const,
    createdAt: null,
    updatedAt: null,
  };
}

function enabledPreferences(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    candidateId: CANDIDATE_ID,
    state: JobPreferenceState.ENABLED,
    version: 1,
    consentVersion: 1 as const,
    consentedAt: '2026-08-28T00:00:00.000Z',
    withdrawnAt: null,
    targetRoles: ['Backend Engineer'],
    preferredLocations: ['Ha Noi'],
    preferredJobTypes: [JobType.FULL_TIME],
    minimumSalary: '20000000.00',
    currency: 'VND' as const,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function job(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    companyId: '55555555-5555-4555-8555-555555555555',
    createdBy: '66666666-6666-4666-8666-666666666666',
    title: 'Backend Engineer',
    description: 'Build recruitment services',
    requirements: 'NestJS and PostgreSQL',
    benefits: 'Remote work',
    salaryMin: new Prisma.Decimal('20000000.00'),
    salaryMax: new Prisma.Decimal('30000000.00'),
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 3,
    quantity: 2,
    skills: ['NestJS'],
    deadline: new Date('2099-12-31T00:00:00.000Z'),
    status: JobStatus.PUBLISHED,
    aggregateVersion: 1,
    publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    rejectionReason: 'must stay private',
    reviewedBy: '77777777-7777-4777-8777-777777777777',
    reviewedAt: new Date('2026-08-19T00:00:00.000Z'),
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}
