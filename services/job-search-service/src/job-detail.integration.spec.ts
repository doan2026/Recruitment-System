import { JobStatus, JobType } from '@prisma/client';
import { CompanyClientService } from './company-client.service';
import { JobAvailabilityReason } from './job-availability.dto';
import { JobEventPublisherService } from './job-event-publisher.service';
import { JobIndexingService } from './job-indexing.service';
import { JobService } from './job.service';
import { PrismaService } from './prisma.service';

const integrationDescribe =
  process.env.JOB_INTEGRATION_TEST === '1' ? describe : describe.skip;
const COMPANY_ID = '71111111-1111-4111-8111-111111111111';
const RECRUITER_ID = '72222222-2222-4222-8222-222222222222';
const PUBLISHED_ID = '73333333-3333-4333-8333-333333333333';
const DRAFT_ID = '74444444-4444-4444-8444-444444444444';
const CLOSED_ID = '75555555-5555-4555-8555-555555555555';
const MISSING_ID = '76666666-6666-4666-8666-666666666666';
const TEST_IDS = [PUBLISHED_ID, DRAFT_ID, CLOSED_ID, MISSING_ID];

integrationDescribe('Job bulk detail PostgreSQL contract', () => {
  let prisma: PrismaService;
  let service: JobService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    await prisma.job.deleteMany({ where: { id: { in: TEST_IDS } } });
    const base = {
      companyId: COMPANY_ID,
      createdBy: RECRUITER_ID,
      description: 'Public description',
      requirements: 'NestJS',
      benefits: 'Remote',
      salaryMin: 20_000_000,
      salaryMax: 30_000_000,
      isNegotiable: false,
      currency: 'VND',
      location: 'Ha Noi',
      jobType: JobType.FULL_TIME,
      experienceYears: 2,
      quantity: 1,
      skills: ['NestJS'],
      deadline: new Date('2099-12-31T00:00:00.000Z'),
      aggregateVersion: 1,
      publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    await prisma.job.createMany({
      data: [
        {
          ...base,
          id: PUBLISHED_ID,
          title: 'Published detail',
          status: JobStatus.PUBLISHED,
        },
        {
          ...base,
          id: DRAFT_ID,
          title: 'Private draft',
          status: JobStatus.DRAFT,
          publishedAt: null,
        },
        {
          ...base,
          id: CLOSED_ID,
          title: 'Closed detail',
          status: JobStatus.CLOSED,
        },
      ],
    });
    service = new JobService(
      prisma,
      {} as CompanyClientService,
      {} as JobIndexingService,
      {} as JobEventPublisherService,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.job.deleteMany({ where: { id: { in: TEST_IDS } } });
    await prisma.onModuleDestroy();
  });

  it('returns visible rows in request order and classifies private/missing ids',
  async () => {
    const result = await service.getBulkDetails(
      [CLOSED_ID, DRAFT_ID, PUBLISHED_ID, MISSING_ID],
      new Date('2026-08-26T12:00:00.000Z'),
    );

    expect(result.items.map(({ id }) => id)).toEqual([
      CLOSED_ID,
      PUBLISHED_ID,
    ]);
    expect(result.items[0]).toMatchObject({
      title: 'Closed detail',
      acceptingApplications: false,
      availabilityReason: JobAvailabilityReason.NOT_PUBLISHED,
    });
    expect(result.items[1]).toMatchObject({
      title: 'Published detail',
      acceptingApplications: true,
      availabilityReason: null,
    });
    expect(result.unavailableJobIds).toEqual([DRAFT_ID, MISSING_ID]);
  });
});
