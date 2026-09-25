import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { JwtVerifierService } from '../common/auth/jwt-verifier.service';
import { RolesGuard } from '../common/auth/roles.guard';
import { ApiExceptionFilter } from '../common/errors/api-exception.filter';
import { ApiResponseInterceptor } from '../common/http/api-response.interceptor';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

const KEY = 'job-search-to-company-internal-key-0001';
const COMPANY_ID = '90eec7f1-fb6e-49d0-89ff-7d65d2438ff7';

// Real global guards, filter and interceptor over HTTP: proves the internal
// route is reachable without a user token, only with the scoped key, and is
// not shadowed by the public GET /:id route.
describe('GET /internal/:id over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const companies = {
    getIndexingSummary: jest.fn(),
    getPublicById: jest.fn(),
  };
  const verifier = { verify: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ INTERNAL_API_KEY_JOB_SEARCH: KEY })],
        }),
      ],
      controllers: [CompanyController],
      providers: [
        { provide: CompanyService, useValue: companies },
        { provide: JwtVerifierService, useValue: verifier },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('rejects a caller without the scoped key before reading Company data', async () => {
    const response = await fetch(`${baseUrl}/internal/${COMPANY_ID}`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_INTERNAL_API_KEY',
    });
    expect(companies.getIndexingSummary).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('returns the summary for the scoped key without a user token', async () => {
    companies.getIndexingSummary.mockResolvedValue({
      id: COMPANY_ID,
      name: 'Acme Vietnam',
      verifiedStatus: 'PENDING',
    });

    const response = await fetch(`${baseUrl}/internal/${COMPANY_ID}`, {
      headers: { 'x-internal-api-key': KEY },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      data: { id: COMPANY_ID, name: 'Acme Vietnam', verifiedStatus: 'PENDING' },
    });
    expect(companies.getIndexingSummary).toHaveBeenCalledWith(COMPANY_ID);
    expect(companies.getPublicById).not.toHaveBeenCalled();
  });

  it('validates the company id with the existing UUID pipe', async () => {
    const response = await fetch(`${baseUrl}/internal/not-a-uuid`, {
      headers: { 'x-internal-api-key': KEY },
    });

    expect(response.status).toBe(400);
    expect(companies.getIndexingSummary).not.toHaveBeenCalled();
  });

  it('keeps the public profile route on GET /:id', async () => {
    companies.getPublicById.mockResolvedValue({ id: COMPANY_ID });

    const response = await fetch(`${baseUrl}/${COMPANY_ID}`);

    expect(response.status).toBe(200);
    expect(companies.getPublicById).toHaveBeenCalledWith(COMPANY_ID);
    expect(companies.getIndexingSummary).not.toHaveBeenCalled();
  });
});
