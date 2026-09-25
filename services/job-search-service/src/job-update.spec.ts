import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import { CreateJobDto, UpdateJobDto } from './job.dto';
import { JobService } from './job.service';
import { PrismaService } from './prisma.service';
import { CompanyClientService } from './company-client.service';
import { JobIndexingService } from './job-indexing.service';
import { JobEventPublisherService } from './job-event-publisher.service';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '33333333-3333-4333-8333-333333333333';
const JOB = '44444444-4444-4444-8444-444444444444';
const input = (): CreateJobDto => ({
  title: 'Original title', description: 'Build recruitment services',
  requirements: 'NestJS', benefits: 'Remote work', isNegotiable: true,
  currency: 'USD', location: 'Ha Noi', jobType: JobType.FULL_TIME,
  experienceYears: 2, quantity: 2, skills: ['NestJS'], deadline: '2099-12-31',
});

function harness(overrides: Partial<Job> = {}) {
  let row: Job = {
    ...input(), id: JOB, companyId: COMPANY, createdBy: USER,
    salaryMin: null, salaryMax: null, deadline: new Date('2099-12-31T00:00:00Z'),
    status: JobStatus.DRAFT, aggregateVersion: 1, publishedAt: null,
    rejectionReason: null, reviewedBy: null, reviewedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
  const create = jest.fn();
  const updateMany = jest.fn(async ({ where, data }) => {
    if (where.aggregateVersion !== row.aggregateVersion) return { count: 0 };
    row = { ...row, ...data, aggregateVersion: row.aggregateVersion + 1 };
    return { count: 1 };
  });
  const transactionClient = {
    job: { create, updateMany, findUnique: jest.fn(async () => ({ ...row })) },
  };
  const database = {
    ...transactionClient,
    $transaction: jest.fn(async (callback) => callback(transactionClient)),
  };
  const companies = {
    getRecruiterCompany: jest.fn(async () => ({
      companyId: COMPANY, memberRole: 'OWNER', verifiedStatus: 'VERIFIED',
    })),
  };
  const indexing = { append: jest.fn(), wake: jest.fn() };
  const events = { append: jest.fn(), wake: jest.fn() };
  return {
    service: new JobService(database as unknown as PrismaService,
      companies as unknown as CompanyClientService,
      indexing as unknown as JobIndexingService,
      events as unknown as JobEventPublisherService),
    row: () => row, database, indexing, events,
  };
}

describe('Job update browser contract', () => {
  it('rejects a stale full form after another completed edit without overwriting it', async () => {
    const test = harness();
    const staleForm = { ...input(), expectedVersion: 1, benefits: 'New benefit from tab B' };
    const updated = await test.service.update(USER, 'Bearer mock', JOB, {
      expectedVersion: 1, title: 'New title from tab A',
    });
    expect(updated.aggregateVersion).toBe(2);
    await expect(test.service.update(USER, 'Bearer mock', JOB, staleForm))
      .rejects.toMatchObject({ code: 'JOB_STATE_CHANGED', status: 409 });
    expect(test.row().title).toBe('New title from tab A');
    expect(test.row().aggregateVersion).toBe(2);
    expect(test.database.job.updateMany).toHaveBeenCalledTimes(1);
    expect(test.events.append).toHaveBeenCalledTimes(1);
  });

  it('keeps USD on a partial update when currency was omitted by the client', async () => {
    const test = harness();
    const dto = plainToInstance(UpdateJobDto, { expectedVersion: 1, benefits: 'Health insurance' });
    expect(dto.currency).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
    const response = await test.service.update(USER, 'Bearer mock', JOB, dto);
    expect(response.currency).toBe('USD');
    expect(test.row().currency).toBe('USD');
  });

  it.each([undefined, null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expectedVersion %p at the DTO boundary', async (expectedVersion) => {
      const dto = plainToInstance(UpdateJobDto, { expectedVersion, benefits: 'Health insurance' });
      expect((await validate(dto)).map(({ property }) => property)).toContain('expectedVersion');
    },
  );

  it('rejects version-only updates without an outbox event or version bump', async () => {
    const test = harness();
    await expect(test.service.update(USER, 'Bearer mock', JOB, { expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'EMPTY_UPDATE' });
    expect(test.database.$transaction).not.toHaveBeenCalled();
  });

  describe('PUBLISHED edits submitted as the full browser form', () => {
    const publishedAt = new Date('2026-09-01T00:00:00Z');
    const published = () => harness({
      status: JobStatus.PUBLISHED, publishedAt, isNegotiable: false, currency: 'VND',
      salaryMin: new Prisma.Decimal('10000000'), salaryMax: new Prisma.Decimal('20000000'),
    });
    const fullForm = (changes: Partial<CreateJobDto> = {}) => ({
      ...input(), isNegotiable: false, currency: 'VND',
      salaryMin: 10000000, salaryMax: 20000000, expectedVersion: 1, ...changes,
    });

    it.each([
      ['deadline', { deadline: '2099-06-30' }],
      ['quantity', { quantity: 5 }],
      ['benefits', { benefits: 'Health insurance' }],
      ['nothing', {}],
    ] as const)('keeps the job PUBLISHED when only %s changes', async (_, changes) => {
      const test = published();
      const response = await test.service.update(USER, 'Bearer mock', JOB, fullForm(changes));
      expect(response.status).toBe(JobStatus.PUBLISHED);
      expect(test.row().publishedAt).toEqual(publishedAt);
    });

    it.each([
      ['title', { title: 'Senior title' }],
      ['description', { description: 'Changed duties' }],
      ['requirements', { requirements: 'Java' }],
      ['salaryMax', { salaryMax: 25000000 }],
      ['currency', { currency: 'usd' }],
      ['isNegotiable', { isNegotiable: true, salaryMin: undefined, salaryMax: undefined }],
    ] as const)('sends the job back to PENDING_APPROVAL when %s changes', async (_, changes) => {
      const test = published();
      const response = await test.service.update(USER, 'Bearer mock', JOB, fullForm(changes));
      expect(response.status).toBe(JobStatus.PENDING_APPROVAL);
      expect(test.row().publishedAt).toBeNull();
    });

    it('compares normalized text so surrounding whitespace is not a content change', async () => {
      const test = published();
      const response = await test.service.update(USER, 'Bearer mock', JOB,
        fullForm({ title: '  Original title  ', description: 'Build recruitment services\n' }));
      expect(response.status).toBe(JobStatus.PUBLISHED);
    });
  });

  it.each([
    ['title', 'Backend\tEngineer'],
    ['title', 'Backend\u0085Engineer'],
    ['location', 'Ha\u0007 Noi'],
  ] as const)('rejects control characters in single-line %s', async (field, value) => {
    const test = harness();
    await expect(test.service.create(USER, 'Bearer mock', { ...input(), [field]: value }))
      .rejects.toMatchObject({ code: 'INVALID_JOB_CONTENT', details: { field } });
    expect(test.database.job.create).not.toHaveBeenCalled();
  });

  it.each(['title', 'description', 'requirements', 'benefits', 'location'] as const)(
    'rejects whitespace-only %s both through the HTTP DTO and direct service call', async (field) => {
      const value = { ...input(), [field]: '  \u3000  ' };
      const dto = plainToInstance(CreateJobDto, value);
      expect((await validate(dto)).map(({ property }) => property)).toContain(field);
      const test = harness();
      await expect(test.service.create(USER, 'Bearer mock', value))
        .rejects.toMatchObject({ code: 'INVALID_JOB_CONTENT', details: { field } });
      expect(test.database.job.create).not.toHaveBeenCalled();
      expect(test.events.append).not.toHaveBeenCalled();
    },
  );
});
