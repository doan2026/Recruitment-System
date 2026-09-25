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

describe('Company name lookup for indexing', () => {
  const KEY = 'job-search-to-company-indexing-key-0001';
  const indexingClient = (key: string | undefined) => new CompanyClientService(new ConfigService({
    COMPANY_SERVICE_URL: 'http://company-service:3000',
    COMPANY_INTERNAL_API_KEY: key,
  }));

  it('reads the internal summary so a PENDING company keeps its jobs indexable', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response({
      data: { id: COMPANY, name: 'Acme Vietnam', verifiedStatus: 'PENDING' }, meta: null,
    }));
    await expect(indexingClient(KEY).getCompanyNameForIndexing(COMPANY)).resolves.toBe('Acme Vietnam');
    expect(fetchMock).toHaveBeenCalledWith(`http://company-service:3000/internal/${COMPANY}`,
      expect.objectContaining({
        redirect: 'error', cache: 'no-store',
        headers: { accept: 'application/json', 'x-internal-api-key': KEY },
      }));
  });

  it.each([undefined, 'short', 'replace-with-a-distinct-job-search-to-company-key'])(
    'refuses to call Company without a usable key (%p)', async (key) => {
      const fetchMock = jest.spyOn(global, 'fetch');
      await expect(indexingClient(key).getCompanyNameForIndexing(COMPANY)).rejects.toThrow('COMPANY_INTERNAL_API_KEY');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a non-2xx response', response({ code: 'COMPANY_NOT_FOUND' }, 404)],
    ['another company', response({ data: { id: USER, name: 'Acme Vietnam' }, meta: null })],
    ['a control character in the name', response({ data: { id: COMPANY, name: 'Acme\u0085' }, meta: null })],
  ])('treats %s as a retryable indexing failure', async (_, reply) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(reply);
    await expect(indexingClient(KEY).getCompanyNameForIndexing(COMPANY)).rejects.toThrow();
  });
});
