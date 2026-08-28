import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import {
  AiRecommendationClientService,
} from './ai-recommendation-client.service';
import {
  JobRecommendationFallbackReason,
  JobRecommendationQueryDto,
  JobRecommendationSource,
} from './job-recommendation.dto';
import { JobRecommendationService } from './job-recommendation.service';
import {
  ProfileRecommendationClientService,
} from './profile-recommendation-client.service';
import { PrismaService } from './prisma.service';

const integrationDescribe =
  process.env.JOB_INTEGRATION_TEST === '1' ? describe : describe.skip;
const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const CV_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const RECRUITER_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-28T12:00:00.000Z');

integrationDescribe('Job recommendation PostgreSQL revalidation', () => {
  jest.setTimeout(30_000);

  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await prisma.jobIndexSync.deleteMany();
    await prisma.jobEventOutbox.deleteMany();
    await prisma.job.deleteMany();
  });

  afterAll(async () => {
    if (prisma) await prisma.onModuleDestroy();
  });

  it('keeps AI order while filtering stale lifecycle/deadline/metadata',
  async () => {
    const validSecond = await createJob(2, {
      publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    const validFirst = await createJob(1, {
      publishedAt: new Date('2026-08-19T00:00:00.000Z'),
      isNegotiable: true,
      salaryMin: null,
      salaryMax: null,
    });
    const pastDeadline = await createJob(3, {
      deadline: new Date('2026-08-27T00:00:00.000Z'),
    });
    const closed = await createJob(4, { status: JobStatus.CLOSED });
    const wrongLocation = await createJob(5, { location: 'Da Nang' });
    const wrongSalary = await createJob(6, {
      salaryMin: new Prisma.Decimal('5000000.00'),
      salaryMax: new Prisma.Decimal('10000000.00'),
    });
    const wrongJobType = await createJob(7, {
      jobType: JobType.PART_TIME,
    });
    const sourceBefore = await prisma.job.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, aggregateVersion: true, updatedAt: true },
    });
    const ai = {
      recommendJobs: jest.fn().mockResolvedValue({
        items: [
          { jobId: validFirst.id, score: 0.95 },
          { jobId: pastDeadline.id, score: 0.9 },
          { jobId: closed.id, score: 0.85 },
          { jobId: wrongLocation.id, score: 0.8 },
          { jobId: validSecond.id, score: 0.75 },
          { jobId: wrongSalary.id, score: 0.7 },
          { jobId: wrongJobType.id, score: 0.65 },
        ],
        nextCursor: 'page-2',
        reason: null,
      }),
    } as unknown as AiRecommendationClientService;
    const service = new JobRecommendationService(
      prisma,
      {
        getPreferredCv: jest.fn().mockResolvedValue({ cvId: CV_ID }),
      } as unknown as ProfileRecommendationClientService,
      ai,
    );

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer candidate.jwt',
      {
        limit: 10,
        location: 'ha noi',
        salaryMin: 25_000_000,
        jobType: JobType.FULL_TIME,
      } as JobRecommendationQueryDto,
      NOW,
    );

    expect(result).toMatchObject({
      source: JobRecommendationSource.AI,
      fallbackReason: null,
      nextCursor: 'page-2',
    });
    expect(result.items.map(({ id, score }) => ({ id, score }))).toEqual([
      { id: validFirst.id, score: 0.95 },
      { id: validSecond.id, score: 0.75 },
    ]);
    expect(result.items.every(({ companyName }) => companyName === null))
      .toBe(true);
    expect(result.items[0]).not.toHaveProperty('createdBy');
    expect(result.items[0]).not.toHaveProperty('requirements');
    expect(result.items[0]).not.toHaveProperty('benefits');
    expect(result.items[0]).not.toHaveProperty('reviewedBy');
    expect(await prisma.job.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, aggregateVersion: true, updatedAt: true },
    })).toEqual(sourceBefore);
    expect(await prisma.jobEventOutbox.count()).toBe(0);
    expect(await prisma.jobIndexSync.count()).toBe(0);
  });

  it('returns deterministic filtered latest jobs when no active CV exists',
  async () => {
    const newestA = await createJob(10, {
      publishedAt: new Date('2026-08-27T12:00:00.000Z'),
    });
    const newestB = await createJob(11, {
      publishedAt: new Date('2026-08-27T12:00:00.000Z'),
    });
    const olderTodayDeadline = await createJob(12, {
      deadline: new Date('2026-08-28T00:00:00.000Z'),
      publishedAt: new Date('2026-08-26T12:00:00.000Z'),
    });
    await createJob(13, {
      deadline: new Date('2026-08-27T00:00:00.000Z'),
      publishedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    await createJob(14, {
      status: JobStatus.CLOSED,
      publishedAt: new Date('2026-08-29T00:00:00.000Z'),
    });
    await createJob(15, {
      location: 'Da Nang',
      publishedAt: new Date('2026-08-30T00:00:00.000Z'),
    });
    await createJob(16, {
      salaryMin: new Prisma.Decimal('5000000.00'),
      salaryMax: new Prisma.Decimal('10000000.00'),
      publishedAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    await createJob(17, {
      jobType: JobType.PART_TIME,
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const ai = {
      recommendJobs: jest.fn(),
    } as unknown as AiRecommendationClientService;
    const service = new JobRecommendationService(
      prisma,
      {
        getPreferredCv: jest.fn().mockResolvedValue(null),
      } as unknown as ProfileRecommendationClientService,
      ai,
    );

    const result = await service.recommend(
      CANDIDATE_ID,
      'Bearer candidate.jwt',
      {
        limit: 3,
        location: 'HA NOI',
        salaryMin: 25_000_000,
        jobType: JobType.FULL_TIME,
      } as JobRecommendationQueryDto,
      NOW,
    );

    expect(ai.recommendJobs).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: JobRecommendationSource.LATEST,
      fallbackReason: JobRecommendationFallbackReason.NO_ACTIVE_CV,
      nextCursor: null,
    });
    expect(result.items.map(({ id }) => id)).toEqual([
      newestA.id,
      newestB.id,
      olderTodayDeadline.id,
    ]);
    expect(result.items.every(({ score }) => score === null)).toBe(true);
  });

  async function createJob(
    sequence: number,
    overrides: Partial<Job> = {},
  ): Promise<Job> {
    return prisma.job.create({
      data: {
        id: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        companyId: COMPANY_ID,
        createdBy: RECRUITER_ID,
        title: `Backend Engineer ${sequence}`,
        description: 'Build recruitment services',
        requirements: 'NestJS and PostgreSQL',
        benefits: 'Remote work',
        salaryMin: '20000000.00',
        salaryMax: '30000000.00',
        isNegotiable: false,
        currency: 'VND',
        location: 'Ha Noi',
        jobType: JobType.FULL_TIME,
        experienceYears: 3,
        quantity: 2,
        skills: ['NestJS', 'PostgreSQL'],
        deadline: new Date('2099-12-31T00:00:00.000Z'),
        status: JobStatus.PUBLISHED,
        aggregateVersion: 3,
        publishedAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-21T00:00:00.000Z'),
        ...overrides,
      },
    });
  }
});
