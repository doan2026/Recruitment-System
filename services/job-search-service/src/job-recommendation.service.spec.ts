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
  let recommendJobs: jest.Mock;
  let service: JobRecommendationService;

  beforeEach(() => {
    findMany = jest.fn();
    getPreferredCv = jest.fn().mockResolvedValue({ cvId: CV_ID });
    recommendJobs = jest.fn();
    service = new JobRecommendationService(
      { job: { findMany } } as unknown as PrismaService,
      { getPreferredCv } as unknown as ProfileRecommendationClientService,
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
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(JobRecommendationSource.LATEST);
    expect(result.fallbackReason).toBe(reason);
    expect(result.items[0].score).toBeNull();
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
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

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
