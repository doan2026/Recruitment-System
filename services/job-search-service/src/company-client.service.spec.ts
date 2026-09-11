import { ConfigService } from '@nestjs/config';
import { CompanyClientService } from './company-client.service';
import { JobService } from './job.service';
import { PrismaService } from './prisma.service';
import { JobIndexingService } from './job-indexing.service';
import { JobEventPublisherService } from './job-event-publisher.service';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '33333333-3333-4333-8333-333333333333';
const token = 'Bearer signed.jwt.token';
const valid = { companyId: COMPANY, name: 'Acme Vietnam', verifiedStatus: 'VERIFIED', memberRole: 'MEMBER' };
const client = () => new CompanyClientService(new ConfigService({
  COMPANY_SERVICE_URL: 'http://company-service:3000',
}));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

afterEach(() => jest.restoreAllMocks());

describe('Company authorization for Job CRUD', () => {
  it('uses the bounded no-store, no-redirect contract for normal CRUD too', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response({ data: valid, meta: null }));
    await expect(client().getRecruiterCompany(USER, token)).resolves.toEqual(valid);
    expect(fetchMock).toHaveBeenCalledWith(`http://company-service:3000/by-user/${USER}`,
      expect.objectContaining({ redirect: 'error', cache: 'no-store', headers: { accept: 'application/json', authorization: token } }));
  });

  it.each([
    {}, { companyId: COMPANY }, { ...valid, memberRole: undefined },
    { ...valid, memberRole: 'owner' }, { ...valid, companyId: undefined },
    { ...valid, companyId: 'not-a-uuid' }, { ...valid, verifiedStatus: 'UNKNOWN' },
  ])('rejects malformed membership before querying Job data: %p', async (data) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ data, meta: null }));
    const findMany = jest.fn();
    const jobs = new JobService({ job: { findMany } } as unknown as PrismaService,
      client(), {} as JobIndexingService, {} as JobEventPublisherService);
    await expect(jobs.listManaged(USER, token)).rejects.toMatchObject({
      code: 'COMPANY_SERVICE_UNAVAILABLE', status: 503,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not relay downstream body details or treat a 200 error envelope as membership', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ code: 'INTERNAL_DETAIL', message: 'private details' }));
    await expect(client().getRecruiterCompany(USER, token)).rejects.toMatchObject({
      code: 'COMPANY_SERVICE_UNAVAILABLE', message: 'Company Service is unavailable',
    });
  });
});
