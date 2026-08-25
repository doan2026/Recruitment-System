import {
  Job,
  JobEventAction,
  JobStatus,
  JobType,
  Prisma,
} from '@prisma/client';
import {
  buildJobEvent,
  JOB_EVENT_PAYLOAD_FIELDS,
  JOB_EVENT_SCHEMA_VERSION,
} from './job-event';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const OCCURRED_AT = new Date('2026-08-26T03:04:05.678Z');

function persistedJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    companyId: COMPANY_ID,
    createdBy: '44444444-4444-4444-8444-444444444444',
    title: 'Backend Engineer',
    description: 'Build recruitment services',
    requirements: 'NestJS, Kafka and PostgreSQL',
    benefits: 'Remote work',
    salaryMin: new Prisma.Decimal('20000000'),
    salaryMax: new Prisma.Decimal('30000000.5'),
    isNegotiable: false,
    currency: 'VND',
    location: 'Ha Noi',
    jobType: JobType.FULL_TIME,
    experienceYears: 2,
    quantity: 2,
    skills: ['NestJS', 'Kafka'],
    deadline: new Date('2099-12-31T00:00:00.000Z'),
    status: JobStatus.PUBLISHED,
    aggregateVersion: 7,
    publishedAt: OCCURRED_AT,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    updatedAt: OCCURRED_AT,
    ...overrides,
  };
}

describe('buildJobEvent', () => {
  it('builds the exact flat snake_case v1 contract consumed by AI', () => {
    const event = buildJobEvent(
      persistedJob(),
      JobEventAction.UPDATED,
      EVENT_ID,
      OCCURRED_AT,
    );

    expect(Object.keys(event)).toEqual(JOB_EVENT_PAYLOAD_FIELDS);
    const durablePayload: Prisma.InputJsonValue = event;
    expect(durablePayload).toEqual(event);
    expect(event).toEqual({
      event_id: EVENT_ID,
      action: 'UPDATED',
      job_id: JOB_ID,
      company_id: COMPANY_ID,
      title: 'Backend Engineer',
      description: 'Build recruitment services',
      skills: ['NestJS', 'Kafka'],
      location: 'Ha Noi',
      status: 'PUBLISHED',
      occurred_at: '2026-08-26T03:04:05.678Z',
      schema_version: JOB_EVENT_SCHEMA_VERSION,
      aggregate_version: 7,
      requirements: 'NestJS, Kafka and PostgreSQL',
      salary_min: '20000000.00',
      salary_max: '30000000.50',
      job_type: 'FULL_TIME',
    });
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  it('emits null rather than omitting negotiable salary fields', () => {
    const event = buildJobEvent(
      persistedJob({
        status: JobStatus.DRAFT,
        salaryMin: null,
        salaryMax: null,
        isNegotiable: true,
        aggregateVersion: 1,
      }),
      JobEventAction.CREATED,
      EVENT_ID,
      OCCURRED_AT,
    );

    expect(event.salary_min).toBeNull();
    expect(event.salary_max).toBeNull();
    expect(Object.keys(event)).toEqual(JOB_EVENT_PAYLOAD_FIELDS);
  });

  it('copies and freezes the payload so its durable JSON cannot drift', () => {
    const job = persistedJob();
    const event = buildJobEvent(
      job,
      JobEventAction.UPDATED,
      EVENT_ID,
      OCCURRED_AT,
    );

    job.skills.push('PostgreSQL');

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.skills)).toBe(true);
    expect(event.skills).toEqual(['NestJS', 'Kafka']);
  });

  it.each([
    [JobEventAction.CREATED, JobStatus.DRAFT],
    [JobEventAction.UPDATED, JobStatus.DRAFT],
    [JobEventAction.UPDATED, JobStatus.PENDING_APPROVAL],
    [JobEventAction.UPDATED, JobStatus.PUBLISHED],
    [JobEventAction.CLOSED, JobStatus.CLOSED],
    [JobEventAction.EXPIRED, JobStatus.EXPIRED],
  ])(
    'accepts AI-compatible action %s with status %s',
    (action, status) => {
      expect(() =>
        buildJobEvent(
          persistedJob({ status }),
          action,
          EVENT_ID,
          OCCURRED_AT,
        ),
      ).not.toThrow();
    },
  );

  it.each([
    [JobEventAction.CREATED, JobStatus.PUBLISHED],
    [JobEventAction.UPDATED, JobStatus.CLOSED],
    [JobEventAction.CLOSED, JobStatus.PUBLISHED],
    [JobEventAction.EXPIRED, JobStatus.CLOSED],
  ])(
    'rejects action %s with incompatible status %s',
    (action, status) => {
      expect(() =>
        buildJobEvent(
          persistedJob({ status }),
          action,
          EVENT_ID,
          OCCURRED_AT,
        ),
      ).toThrow('is incompatible with status');
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid aggregate version %s',
    (aggregateVersion) => {
      expect(() =>
        buildJobEvent(
          persistedJob({ aggregateVersion }),
          JobEventAction.UPDATED,
          EVENT_ID,
          OCCURRED_AT,
        ),
      ).toThrow('positive integer');
    },
  );

  it('rejects an invalid occurrence time', () => {
    expect(() =>
      buildJobEvent(
        persistedJob(),
        JobEventAction.UPDATED,
        EVENT_ID,
        new Date(Number.NaN),
      ),
    ).toThrow('occurrence time must be valid');
  });
});
