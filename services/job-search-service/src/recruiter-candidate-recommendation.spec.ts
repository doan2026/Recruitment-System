import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Job, JobStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AiCandidateRecommendationClientService,
  AiCandidateRecommendationCursorStaleError,
} from './ai-candidate-recommendation-client.service';
import { ApiException, SystemRole } from './common';
import { CompanyClientService } from './company-client.service';
import { JobIndexingService } from './job-indexing.service';
import { JobRecommendationService } from './job-recommendation.service';
import { JobSearchService } from './job-search.service';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { JobEventPublisherService } from './job-event-publisher.service';
import {
  CandidateDiscoveryEligibility,
  ProfileCandidateDiscoveryClientService,
  ProfileCandidateDiscoveryUnavailableError,
} from './profile-candidate-discovery-client.service';
import { PrismaService } from './prisma.service';
import {
  RecruiterCandidateRecommendationQueryDto,
  RecruiterCandidateRecommendationReason,
} from './recruiter-candidate-recommendation.dto';
import { RecruiterCandidateRecommendationService } from './recruiter-candidate-recommendation.service';

const RECRUITER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RECRUITER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_ID = '44444444-4444-4444-8444-444444444444';
const CANDIDATE_ID_1 = '55555555-5555-4555-8555-555555555555';
const CANDIDATE_ID_2 = '66666666-6666-4666-8666-666666666666';
const CV_ID_1 = '77777777-7777-4777-8777-777777777777';
const CV_ID_2 = '88888888-8888-4888-8888-888888888888';
const AUTHORIZATION = 'Bearer recruiter.jwt.token';
const NOW = new Date('2026-08-28T20:00:00.000Z');

describe('RecruiterCandidateRecommendationService', () => {
  let authorize: jest.Mock;
  let revalidate: jest.Mock;
  let getSnapshot: jest.Mock;
  let resolve: jest.Mock;
  let recommendCandidates: jest.Mock;
  let service: RecruiterCandidateRecommendationService;

  beforeEach(() => {
    authorize = jest.fn().mockResolvedValue({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      recruiterId: RECRUITER_ID,
      memberRole: 'OWNER',
      aggregateVersion: 7,
    });
    revalidate = jest.fn().mockResolvedValue(undefined);
    getSnapshot = jest.fn().mockResolvedValue(eligibility());
    resolve = jest.fn().mockResolvedValue([
      profile(CANDIDATE_ID_2, 'Senior Engineer'),
      profile(CANDIDATE_ID_1, null),
    ]);
    recommendCandidates = jest.fn().mockResolvedValue({
      items: [
        { candidateId: CANDIDATE_ID_2, score: 0.91 },
        { candidateId: CANDIDATE_ID_1, score: 0.81 },
      ],
      nextCursor: 'next-page',
      reason: null,
    });
    service = new RecruiterCandidateRecommendationService(
      {
        authorizeCandidateRecommendation: authorize,
        revalidateCandidateRecommendation: revalidate,
      } as unknown as JobService,
      { getSnapshot, resolve } as unknown as ProfileCandidateDiscoveryClientService,
      { recommendCandidates } as unknown as AiCandidateRecommendationClientService,
    );
  });

  it('authorizes before downstream, preserves AI order and returns no CV/version',
  async () => {
    const query = { limit: 2 } as RecruiterCandidateRecommendationQueryDto;
    const routeJobId = JOB_ID.toUpperCase();
    const result = await service.recommend(
      RECRUITER_ID,
      AUTHORIZATION,
      routeJobId,
      query,
      NOW,
    );

    expect(authorize).toHaveBeenCalledWith(
      RECRUITER_ID,
      AUTHORIZATION,
      routeJobId,
      NOW,
    );
    expect(authorize.mock.invocationCallOrder[0])
      .toBeLessThan(getSnapshot.mock.invocationCallOrder[0]);
    expect(recommendCandidates).toHaveBeenCalledWith(
      JOB_ID,
      7,
      eligibility(),
      query,
    );
    expect(resolve).toHaveBeenCalledWith([
      eligibility()[1],
      eligibility()[0],
    ]);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_ID, aggregateVersion: 7 }),
      AUTHORIZATION,
    );
    expect(result).toEqual({
      jobId: JOB_ID,
      items: [
        {
          candidateId: CANDIDATE_ID_2,
          fullName: `Candidate ${CANDIDATE_ID_2.slice(0, 4)}`,
          headline: 'Senior Engineer',
          skills: ['TypeScript', 'PostgreSQL'],
          score: 0.91,
        },
        {
          candidateId: CANDIDATE_ID_1,
          fullName: `Candidate ${CANDIDATE_ID_1.slice(0, 4)}`,
          headline: null,
          skills: ['TypeScript', 'PostgreSQL'],
          score: 0.81,
        },
      ],
      nextCursor: 'next-page',
      reason: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /cvId|discoveryVersion|profileVersion|phone|email/,
    );
  });

  it('returns a stable empty reason without calling AI or resolver', async () => {
    getSnapshot.mockResolvedValue([]);

    await expect(service.recommend(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      { limit: 10 } as RecruiterCandidateRecommendationQueryDto,
      NOW,
    )).resolves.toEqual({
      jobId: JOB_ID,
      items: [],
      nextCursor: null,
      reason: RecruiterCandidateRecommendationReason.NO_DISCOVERABLE_CANDIDATES,
    });
    expect(recommendCandidates).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it('returns cursor-stale when a continuation discovery snapshot is empty',
  async () => {
    getSnapshot.mockResolvedValue([]);

    await expect(service.recommend(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      {
        limit: 10,
        cursor: 'continuation',
      } as RecruiterCandidateRecommendationQueryDto,
      NOW,
    )).rejects.toMatchObject({
      code: 'RECOMMENDATION_CURSOR_STALE',
      status: HttpStatus.CONFLICT,
    });
    expect(recommendCandidates).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('reports configured only when Company, Profile and AI configs are safe',
  () => {
    const configured = (
      company: boolean,
      profileConfigured: boolean,
      aiConfigured: boolean,
    ) => new RecruiterCandidateRecommendationService(
      {
        isCandidateRecommendationCompanyConfigured: () => company,
      } as unknown as JobService,
      {
        isConfigured: () => profileConfigured,
      } as unknown as ProfileCandidateDiscoveryClientService,
      {
        isConfigured: () => aiConfigured,
      } as unknown as AiCandidateRecommendationClientService,
    ).isConfigured();

    expect(configured(true, true, true)).toBe(true);
    expect(configured(false, true, true)).toBe(false);
    expect(configured(true, false, true)).toBe(false);
    expect(configured(true, true, false)).toBe(false);
  });

  it('fails closed with 409 if Profile omits a ranked Candidate', async () => {
    resolve.mockResolvedValue([profile(CANDIDATE_ID_2, null)]);

    await expect(service.recommend(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      { limit: 2 } as RecruiterCandidateRecommendationQueryDto,
      NOW,
    )).rejects.toMatchObject({
      code: 'RECOMMENDATION_SCOPE_CHANGED',
      status: HttpStatus.CONFLICT,
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('maps stale cursors to 409 and Profile failures to 503', async () => {
    recommendCandidates.mockRejectedValue(
      new AiCandidateRecommendationCursorStaleError(),
    );
    await expect(service.recommend(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      { limit: 2, cursor: 'old' } as RecruiterCandidateRecommendationQueryDto,
      NOW,
    )).rejects.toMatchObject({
      code: 'RECOMMENDATION_CURSOR_STALE',
      status: HttpStatus.CONFLICT,
    });

    recommendCandidates.mockResolvedValue({
      items: [{ candidateId: CANDIDATE_ID_1, score: 0.8 }],
      nextCursor: null,
      reason: null,
    });
    resolve.mockRejectedValue(new ProfileCandidateDiscoveryUnavailableError());
    await expect(service.recommend(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      { limit: 2 } as RecruiterCandidateRecommendationQueryDto,
      NOW,
    )).rejects.toMatchObject({
      code: 'RECOMMENDATION_UNAVAILABLE',
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});

describe('Recruiter candidate recommendation HTTP contract', () => {
  it('validates only bounded limit/cursor query fields', async () => {
    const defaults = plainToInstance(
      RecruiterCandidateRecommendationQueryDto,
      {},
    );
    expect(await validate(defaults)).toHaveLength(0);
    expect(defaults.limit).toBe(10);

    for (const value of [
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { cursor: '🙂'.repeat(300) },
    ]) {
      expect(await validate(plainToInstance(
        RecruiterCandidateRecommendationQueryDto,
        value,
      ))).not.toHaveLength(0);
    }
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(pipe.transform(
      { candidateId: CANDIDATE_ID_1, companyId: COMPANY_ID, cvId: CV_ID_1 },
      {
        type: 'query',
        metatype: RecruiterCandidateRecommendationQueryDto,
        data: undefined,
      },
    )).rejects.toBeDefined();
  });

  it('uses JWT identity, marks the response private and declares Recruiter role',
  async () => {
    const recommend = jest.fn().mockResolvedValue({
      jobId: JOB_ID,
      items: [],
      nextCursor: null,
      reason: RecruiterCandidateRecommendationReason.NO_DISCOVERABLE_CANDIDATES,
    });
    const controller = new JobController(
      {} as JobService,
      {} as JobSearchService,
      {} as JobRecommendationService,
      {} as JobIndexingService,
      { recommend } as unknown as RecruiterCandidateRecommendationService,
    );
    const setHeader = jest.fn();
    const query = { limit: 10 } as RecruiterCandidateRecommendationQueryDto;

    await controller.recommendedCandidates(
      { id: RECRUITER_ID, systemRole: SystemRole.RECRUITER },
      AUTHORIZATION,
      JOB_ID,
      query,
      { setHeader },
    );

    expect(recommend).toHaveBeenCalledWith(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      query,
    );
    expect(setHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store'],
      ['Pragma', 'no-cache'],
      ['Vary', 'Authorization'],
    ]);
    const prototype = JobController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, prototype.recommendedCandidates))
      .toBe(':jobId/recommended-candidates');
    expect(Reflect.getMetadata('roles', prototype.recommendedCandidates))
      .toEqual([SystemRole.RECRUITER]);
  });
});

describe('JobService Candidate recommendation authorization', () => {
  function createService(
    membership: Record<string, unknown>,
    jobValue: Partial<Job> | null,
    revalidated: { id: string } | null = { id: JOB_ID },
    revalidationMembership: Record<string, unknown> = membership,
  ) {
    const getRecruiterCompanyForRecommendation = jest.fn()
      .mockResolvedValueOnce(membership)
      .mockResolvedValue(revalidationMembership);
    const findUnique = jest.fn().mockResolvedValue(jobValue);
    const findFirst = jest.fn().mockResolvedValue(revalidated);
    const service = new JobService(
      { job: { findUnique, findFirst } } as unknown as PrismaService,
      { getRecruiterCompanyForRecommendation } as unknown as CompanyClientService,
      {} as JobIndexingService,
      {} as JobEventPublisherService,
    );
    return {
      service,
      findUnique,
      findFirst,
      getRecruiterCompanyForRecommendation,
    };
  }

  it('allows OWNER and revalidates exact aggregate/lifecycle/deadline', async () => {
    const fixture = createService(
      {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'OWNER',
      },
      manageableJob(),
    );
    const authorization = await fixture.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    );
    await fixture.service.revalidateCandidateRecommendation(
      authorization,
      AUTHORIZATION,
      NOW,
    );

    expect(authorization).toMatchObject({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      recruiterId: RECRUITER_ID,
      memberRole: 'OWNER',
      aggregateVersion: 7,
    });
    expect(fixture.getRecruiterCompanyForRecommendation).toHaveBeenCalledTimes(2);
    expect(fixture.getRecruiterCompanyForRecommendation)
      .toHaveBeenLastCalledWith(RECRUITER_ID, AUTHORIZATION);
    expect(
      fixture.getRecruiterCompanyForRecommendation.mock.invocationCallOrder[1],
    ).toBeLessThan(fixture.findFirst.mock.invocationCallOrder[0]);
    expect(fixture.findFirst).toHaveBeenCalledWith({
      where: {
        id: JOB_ID,
        companyId: COMPANY_ID,
        aggregateVersion: 7,
        status: JobStatus.PUBLISHED,
        deadline: { gte: new Date('2026-08-28T00:00:00.000Z') },
      },
      select: { id: true },
    });
  });

  it('blocks unverified companies before Job lookup', async () => {
    const fixture = createService(
      {
        companyId: COMPANY_ID,
        name: 'Pending Company',
        verifiedStatus: 'PENDING',
        memberRole: 'OWNER',
      },
      manageableJob(),
    );
    await expect(fixture.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    )).rejects.toMatchObject({ code: 'COMPANY_NOT_VERIFIED' });
    expect(fixture.findUnique).not.toHaveBeenCalled();
  });

  it('blocks MEMBER access to another creator and inactive Jobs', async () => {
    const member = createService(
      {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'MEMBER',
      },
      manageableJob({ createdBy: OTHER_RECRUITER_ID }),
    );
    await expect(member.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    )).rejects.toMatchObject({ code: 'JOB_ACCESS_DENIED' });

    const closed = createService(
      {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'OWNER',
      },
      manageableJob({ status: JobStatus.CLOSED }),
    );
    await expect(closed.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    )).rejects.toMatchObject({ code: 'JOB_NOT_RECOMMENDABLE' });
  });

  it('fails revalidation when the Job aggregate changes', async () => {
    const fixture = createService(
      {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'OWNER',
      },
      manageableJob(),
      null,
    );
    const authorization = await fixture.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    );
    await expect(fixture.service.revalidateCandidateRecommendation(
      authorization,
      AUTHORIZATION,
      NOW,
    )).rejects.toMatchObject({
      code: 'JOB_RECOMMENDATION_CONTEXT_STALE',
      status: HttpStatus.CONFLICT,
    });
  });

  it.each([
    {
      label: 'company changed',
      membership: {
        companyId: CANDIDATE_ID_1,
        name: 'Another Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'OWNER',
      },
    },
    {
      label: 'verification revoked',
      membership: {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'PENDING',
        memberRole: 'OWNER',
      },
    },
    {
      label: 'OWNER downgraded',
      membership: {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'MEMBER',
      },
    },
  ])('fails closed before Job lookup when $label during ranking',
  async ({ membership }) => {
    const fixture = createService(
      {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'OWNER',
      },
      manageableJob(),
      { id: JOB_ID },
      membership,
    );
    const context = await fixture.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    );

    await expect(fixture.service.revalidateCandidateRecommendation(
      context,
      AUTHORIZATION,
      NOW,
    )).rejects.toMatchObject({
      code: 'JOB_RECOMMENDATION_CONTEXT_STALE',
      status: HttpStatus.CONFLICT,
    });
    expect(fixture.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when Company membership is revoked during ranking',
  async () => {
    const membership = {
      companyId: COMPANY_ID,
      name: 'Verified Company',
      verifiedStatus: 'VERIFIED',
      memberRole: 'OWNER',
    };
    const fixture = createService(membership, manageableJob());
    const context = await fixture.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    );
    fixture.getRecruiterCompanyForRecommendation.mockRejectedValueOnce(
      new ApiException(
        'COMPANY_NOT_FOUND',
        'No company is associated with this recruiter',
        HttpStatus.NOT_FOUND,
      ),
    );

    await expect(fixture.service.revalidateCandidateRecommendation(
      context,
      AUTHORIZATION,
      NOW,
    )).rejects.toMatchObject({
      code: 'JOB_RECOMMENDATION_CONTEXT_STALE',
      status: HttpStatus.CONFLICT,
    });
    expect(fixture.findFirst).not.toHaveBeenCalled();
  });

  it('revalidates MEMBER ownership with the current membership role',
  async () => {
    const membership = {
      companyId: COMPANY_ID,
      name: 'Verified Company',
      verifiedStatus: 'VERIFIED',
      memberRole: 'MEMBER',
    };
    const fixture = createService(membership, manageableJob());
    const context = await fixture.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    );

    await fixture.service.revalidateCandidateRecommendation(
      context,
      AUTHORIZATION,
      NOW,
    );
    expect(fixture.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ createdBy: RECRUITER_ID }),
      select: { id: true },
    });
  });

  it('uses a fresh UTC clock when revalidating after downstream work',
  async () => {
    const fixture = createService(
      {
        companyId: COMPANY_ID,
        name: 'Verified Company',
        verifiedStatus: 'VERIFIED',
        memberRole: 'OWNER',
      },
      manageableJob(),
    );
    const context = await fixture.service.authorizeCandidateRecommendation(
      RECRUITER_ID,
      AUTHORIZATION,
      JOB_ID,
      NOW,
    );
    jest.useFakeTimers({ now: new Date('2026-08-29T00:01:00.000Z') });
    try {
      await fixture.service.revalidateCandidateRecommendation(
        context,
        AUTHORIZATION,
      );
      expect(fixture.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          deadline: { gte: new Date('2026-08-29T00:00:00.000Z') },
        }),
        select: { id: true },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

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

function manageableJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    companyId: COMPANY_ID,
    createdBy: RECRUITER_ID,
    status: JobStatus.PUBLISHED,
    deadline: new Date('2026-08-28T00:00:00.000Z'),
    aggregateVersion: 7,
    ...overrides,
  } as Job;
}
