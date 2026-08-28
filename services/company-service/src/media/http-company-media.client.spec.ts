import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors/api-exception';
import { CompanyMediaAssetType } from './company-media.client';
import { HttpCompanyMediaClient } from './http-company-media.client';

const COMPANY_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const USER_ID = '6625ada7-71aa-4901-aef7-800b8245fbb8';
const FILE_ID = '42786d30-7b9e-4a61-9e6f-2a72ec30633d';
const REFERENCE_UUID = 'a5f34189-642d-4f78-8860-786ba6898998';
const INTERNAL_KEY = 'company-media-key-0123456789abcdef';
const CREATED_AT = '2026-08-28T10:00:00.000Z';
const UPDATED_AT = '2026-08-28T10:01:00.000Z';

type JsonRecord = Record<string, unknown>;

const configuration = (
  overrides: Record<string, unknown> = {},
): ConfigService => {
  const values: Record<string, unknown> = {
    MEDIA_INTERNAL_API_KEY: INTERNAL_KEY,
    MEDIA_SERVICE_URL: 'http://media-service:3006',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
};

const jsonResponse = (
  data: unknown,
  init: ResponseInit = {},
): Response =>
  new Response(JSON.stringify({ data, meta: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const activeMetadata = (
  overrides: JsonRecord = {},
): JsonRecord => ({
  aggregateVersion: 2,
  bytes: 2048,
  createdAt: CREATED_AT,
  format: 'png',
  id: FILE_ID,
  mimeType: 'image/png',
  originalFilename: 'logo.png',
  ownerId: COMPANY_ID,
  ownerType: 'COMPANY',
  privateDelivery: false,
  status: 'ACTIVE',
  type: CompanyMediaAssetType.COMPANY_LOGO,
  updatedAt: UPDATED_AT,
  url: 'https://res.cloudinary.com/recruitment/image/upload/logo.png',
  ...overrides,
});

const deletedMetadata = (
  overrides: JsonRecord = {},
): JsonRecord =>
  activeMetadata({
    aggregateVersion: 3,
    status: 'DELETED',
    url: null,
    ...overrides,
  });

const uploadCapability = (
  overrides: JsonRecord = {},
): JsonRecord => ({
  allowedFormats: ['jpg'],
  apiKey: '123456789012345',
  cloudName: 'recruitment-cloud',
  expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  fileId: FILE_ID,
  maxBytes: 2 * 1024 * 1024,
  params: {
    allowed_formats: 'jpg',
    context: 'file_id=' + FILE_ID,
    folder: 'recruitment/company-logo',
    overwrite: 'false',
    public_id: FILE_ID,
    timestamp: Math.floor(Date.now() / 1000) - 3000,
    type: 'upload',
    unique_filename: 'false',
    upload_preset: 'company_logo_unsigned',
    use_filename: 'false',
  },
  resourceType: 'image',
  signature: 'a'.repeat(64),
  uploadUrl:
    'https://api.cloudinary.com/v1_1/recruitment-cloud/image/upload',
  ...overrides,
});

const expectApiError = async (
  operation: Promise<unknown>,
  code: string,
  status: HttpStatus,
): Promise<void> => {
  const error = await operation.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ApiException);
  expect(error).toMatchObject({ code });
  expect((error as ApiException).getStatus()).toBe(status);
};

const deepClone = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

describe('HttpCompanyMediaClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends canonical verify expectations with distinct internal headers', async () => {
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(activeMetadata()));
    const client = new HttpCompanyMediaClient(
      configuration({
        MEDIA_SERVICE_URL: ' http://media-service:3006 ',
      }),
    );

    await expect(
      client.verifyCompanyFile(
        FILE_ID.toUpperCase(),
        COMPANY_ID.toUpperCase(),
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
    ).resolves.toMatchObject({ id: FILE_ID, url: expect.any(String) });

    expect(timeout).toHaveBeenCalledWith(3000);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://media-service:3006/internal/verify',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': INTERNAL_KEY,
          'X-Internal-Service': 'company-service',
        },
        body: JSON.stringify({
          expectedOwnerId: COMPANY_ID,
          expectedOwnerType: 'COMPANY',
          expectedType: 'COMPANY_LOGO',
          fileId: FILE_ID,
        }),
      }),
    );
  });

  it.each(['100', '10000'])(
    'accepts the bounded request timeout %s',
    async (configuredTimeout) => {
      const timeout = jest
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValue(new AbortController().signal);
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(activeMetadata()));
      const client = new HttpCompanyMediaClient(
        configuration({ MEDIA_REQUEST_TIMEOUT_MS: configuredTimeout }),
      );

      await client.verifyCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      );

      expect(timeout).toHaveBeenCalledWith(Number(configuredTimeout));
    },
  );

  it.each([
    undefined,
    '',
    'ftp://media-service:3006',
    'http://user:pass@media-service:3006',
    'http://media-service:3006/internal',
    'http://media-service:3006?tenant=x',
    'http://media-service:3006#fragment',
  ])('rejects an unsafe Media Service origin: %p', (value) => {
    expect(
      () =>
        new HttpCompanyMediaClient(
          configuration({ MEDIA_SERVICE_URL: value }),
        ),
    ).toThrow(
      expect.objectContaining({
        code: 'MEDIA_SERVICE_CONFIGURATION_ERROR',
      }),
    );
  });

  it.each([
    undefined,
    'short',
    'replace-with-a-real-company-media-key',
    'change-me-company-media-key-0000000',
    'placeholder-company-media-key-00000',
    'valid-company-media-key-0000000\n',
  ])('rejects an unsafe internal API key: %p', (value) => {
    expect(
      () =>
        new HttpCompanyMediaClient(
          configuration({ MEDIA_INTERNAL_API_KEY: value }),
        ),
    ).toThrow(
      expect.objectContaining({
        code: 'MEDIA_SERVICE_CONFIGURATION_ERROR',
      }),
    );
  });

  it.each([99, '99', '10001', '3.5', '-100', 'NaN'])(
    'rejects an invalid request timeout: %p',
    (value) => {
      expect(
        () =>
          new HttpCompanyMediaClient(
            configuration({ MEDIA_REQUEST_TIMEOUT_MS: value }),
          ),
      ).toThrow(
        expect.objectContaining({
          code: 'MEDIA_SERVICE_CONFIGURATION_ERROR',
        }),
      );
    },
  );

  it('creates a strict Company-owned upload capability', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(uploadCapability()));
    const client = new HttpCompanyMediaClient(configuration());

    await expect(
      client.createCompanyUploadIntent(
        COMPANY_ID.toUpperCase(),
        USER_ID.toUpperCase(),
        CompanyMediaAssetType.COMPANY_LOGO,
        '  logo.jpeg  ',
        'company-logo-request-0001',
      ),
    ).resolves.toMatchObject({
      fileId: FILE_ID,
      maxBytes: 2 * 1024 * 1024,
      resourceType: 'image',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://media-service:3006/internal/signature',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'company-logo-request-0001',
          'X-Internal-Service': 'company-service',
        }),
        body: JSON.stringify({
          originalFilename: 'logo.jpeg',
          ownerId: COMPANY_ID,
          ownerType: 'COMPANY',
          requestedBy: USER_ID,
          type: 'COMPANY_LOGO',
        }),
      }),
    );
  });

  it.each([
    [
      CompanyMediaAssetType.COMPANY_LOGO,
      'logo.png',
      'png',
      'recruitment/company-logo',
      'image',
      2 * 1024 * 1024,
    ],
    [
      CompanyMediaAssetType.COMPANY_IMAGE,
      'office.webp',
      'webp',
      'recruitment/company-image',
      'image',
      5 * 1024 * 1024,
    ],
    [
      CompanyMediaAssetType.COMPANY_VIDEO,
      'tour.mp4',
      'mp4',
      'recruitment/company-video',
      'video',
      50 * 1024 * 1024,
    ],
  ] as const)(
    'enforces the upload policy for %s',
    async (type, filename, format, folder, resourceType, maxBytes) => {
      const params = {
        ...(uploadCapability().params as JsonRecord),
        allowed_formats: format,
        folder,
        public_id: FILE_ID,
      };
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(
          uploadCapability({
            allowedFormats: [format],
            maxBytes,
            params,
            resourceType,
            uploadUrl:
              'https://api.cloudinary.com/v1_1/recruitment-cloud/' +
              resourceType +
              '/upload',
          }),
        ),
      );
      const client = new HttpCompanyMediaClient(configuration());

      await expect(
        client.createCompanyUploadIntent(
          COMPANY_ID,
          USER_ID,
          type,
          filename,
        ),
      ).resolves.toMatchObject({
        allowedFormats: [format],
        maxBytes,
        resourceType,
      });
    },
  );

  it.each([
    ['', CompanyMediaAssetType.COMPANY_LOGO, undefined],
    ['logo.exe', CompanyMediaAssetType.COMPANY_LOGO, undefined],
    ['logo/ok.png', CompanyMediaAssetType.COMPANY_LOGO, undefined],
    ['movie.mp4', CompanyMediaAssetType.COMPANY_IMAGE, undefined],
    ['movie.mp4', CompanyMediaAssetType.COMPANY_VIDEO, 'short'],
  ] as const)(
    'rejects invalid upload intent input before calling Media Service',
    async (filename, type, idempotencyKey) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      const client = new HttpCompanyMediaClient(configuration());

      await expectApiError(
        client.createCompanyUploadIntent(
          COMPANY_ID,
          USER_ID,
          type,
          filename,
          idempotencyKey,
        ),
        'MEDIA_REQUEST_INVALID',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['extra capability key', (value: JsonRecord) => (value.extra = true)],
    ['wrong file id', (value: JsonRecord) => (value.fileId = 'not-a-uuid')],
    ['wrong resource type', (value: JsonRecord) => (value.resourceType = 'raw')],
    ['wrong byte policy', (value: JsonRecord) => (value.maxBytes = 1)],
    ['wrong allowed formats', (value: JsonRecord) => (value.allowedFormats = ['png'])],
    ['weak signature', (value: JsonRecord) => (value.signature = 'signed')],
    ['expired capability', (value: JsonRecord) => (value.expiresAt = CREATED_AT)],
    [
      'overlong capability',
      (value: JsonRecord) =>
        (value.expiresAt = new Date(Date.now() + 11 * 60 * 1000).toISOString()),
    ],
    [
      'unexpected parameter',
      (value: JsonRecord) =>
        ((value.params as JsonRecord).unexpected = 'value'),
    ],
    [
      'mismatched context',
      (value: JsonRecord) =>
        ((value.params as JsonRecord).context = 'file_id=' + COMPANY_ID),
    ],
    [
      'mismatched public id',
      (value: JsonRecord) =>
        ((value.params as JsonRecord).public_id = '../logo.jpg'),
    ],
    [
      'mismatched folder',
      (value: JsonRecord) =>
        ((value.params as JsonRecord).folder = 'recruitment/avatar'),
    ],
    [
      'mismatched upload origin',
      (value: JsonRecord) =>
        (value.uploadUrl = 'https://evil.example/upload'),
    ],
  ] as Array<[string, (value: JsonRecord) => void]>)(
    'rejects a malformed upload capability: %s',
    async (_caseName, mutate) => {
      const capability = deepClone(uploadCapability());
      mutate(capability);
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(capability));
      const client = new HttpCompanyMediaClient(configuration());

      await expectApiError(
        client.createCompanyUploadIntent(
          COMPANY_ID,
          USER_ID,
          CompanyMediaAssetType.COMPANY_LOGO,
          'logo.jpeg',
        ),
        'MEDIA_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    },
  );

  it('confirms an upload and validates the echoed Company ownership', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(activeMetadata()));
    const client = new HttpCompanyMediaClient(configuration());

    await expect(
      client.confirmCompanyFile(
        FILE_ID.toUpperCase(),
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
    ).resolves.toEqual(activeMetadata());
    expect(fetchMock).toHaveBeenCalledWith(
      'http://media-service:3006/internal/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fileId: FILE_ID }),
      }),
    );
  });

  it.each([
    ['extra metadata key', { unexpected: true }],
    ['wrong file id', { id: REFERENCE_UUID }],
    ['wrong owner type', { ownerType: 'USER' }],
    ['wrong owner id', { ownerId: USER_ID }],
    ['wrong media type', { type: 'COMPANY_IMAGE' }],
    ['inactive status', { status: 'PENDING' }],
    ['private delivery', { privateDelivery: true }],
    ['missing canonical URL', { url: null }],
    ['non-HTTPS URL', { url: 'http://res.cloudinary.com/logo.png' }],
    ['invalid version', { aggregateVersion: 0 }],
    ['invalid bytes', { bytes: -1 }],
    ['invalid timestamp', { updatedAt: 'not-a-date' }],
    ['reversed timestamps', { updatedAt: '2026-08-27T10:00:00.000Z' }],
  ])('rejects an active metadata invariant violation: %s', async (_, values) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(activeMetadata(values)));
    const client = new HttpCompanyMediaClient(configuration());

    await expectApiError(
      client.verifyCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
      'MEDIA_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('binds a file using exact Company expectations and reference echo', async () => {
    const reference = {
      callerService: 'company-service',
      createdAt: UPDATED_AT,
      fileId: FILE_ID,
      id: REFERENCE_UUID,
      referenceId: COMPANY_ID,
      referenceType: 'COMPANY_LOGO',
    };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(reference));
    const client = new HttpCompanyMediaClient(configuration());

    await expect(
      client.bindCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
        'COMPANY_LOGO',
        COMPANY_ID,
      ),
    ).resolves.toEqual(reference);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://media-service:3006/internal/references',
      expect.objectContaining({
        body: JSON.stringify({
          expectedOwnerId: COMPANY_ID,
          expectedOwnerType: 'COMPANY',
          expectedType: 'COMPANY_LOGO',
          fileId: FILE_ID,
          referenceId: COMPANY_ID,
          referenceType: 'COMPANY_LOGO',
        }),
      }),
    );
  });

  it('rejects invalid or mismatched reference contracts', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const client = new HttpCompanyMediaClient(configuration());

    await expectApiError(
      client.bindCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
        'invalid-type',
        COMPANY_ID,
      ),
      'MEDIA_REQUEST_INVALID',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(
      jsonResponse({
        callerService: 'profile-service',
        createdAt: UPDATED_AT,
        fileId: FILE_ID,
        id: REFERENCE_UUID,
        referenceId: COMPANY_ID,
        referenceType: 'COMPANY_LOGO',
      }),
    );
    await expectApiError(
      client.bindCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
        'COMPANY_LOGO',
        COMPANY_ID,
      ),
      'MEDIA_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('releases a Media reference idempotently using its UUID', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ released: true }));
    const client = new HttpCompanyMediaClient(configuration());

    await expect(
      client.releaseReference(REFERENCE_UUID.toUpperCase()),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://media-service:3006/internal/references/' + REFERENCE_UUID,
      expect.objectContaining({ method: 'DELETE', body: undefined }),
    );

    fetchMock.mockResolvedValue(jsonResponse({ released: false }));
    await expectApiError(
      client.releaseReference(REFERENCE_UUID),
      'MEDIA_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('deletes and validates an unreferenced Company file tombstone', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(deletedMetadata()));
    const client = new HttpCompanyMediaClient(configuration());

    await expect(
      client.deleteCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://media-service:3006/internal/files/' + FILE_ID,
      expect.objectContaining({ method: 'DELETE', body: undefined }),
    );

    fetchMock.mockResolvedValue(
      jsonResponse(deletedMetadata({ url: 'https://stale.example/logo.png' })),
    );
    await expectApiError(
      client.deleteCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
      'MEDIA_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it.each([
    ['wrong content type', new Response('{}', { status: 200 })],
    [
      'invalid JSON',
      new Response('{not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'non-object JSON',
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'missing body',
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'extra envelope key',
      new Response(
        JSON.stringify({ data: activeMetadata(), meta: null, extra: true }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ],
    [
      'non-null metadata',
      new Response(
        JSON.stringify({ data: activeMetadata(), meta: { trace: 'x' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ],
  ] as Array<[string, Response]>)(
    'rejects a malformed response envelope: %s',
    async (_, response) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      const client = new HttpCompanyMediaClient(configuration());

      await expectApiError(
        client.verifyCompanyFile(
          FILE_ID,
          COMPANY_ID,
          CompanyMediaAssetType.COMPANY_LOGO,
        ),
        'MEDIA_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    },
  );

  it('rejects both declared and streamed JSON bodies above 64 KiB', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const client = new HttpCompanyMediaClient(configuration());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: 'x'.repeat(70 * 1024), meta: null }), {
        status: 200,
        headers: {
          'content-length': String(70 * 1024),
          'content-type': 'application/json',
        },
      }),
    );

    await expectApiError(
      client.verifyCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
      'MEDIA_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40 * 1024));
        controller.enqueue(new Uint8Array(40 * 1024));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expectApiError(
      client.verifyCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
      'MEDIA_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('maps network failures without exposing their messages', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connect ECONNREFUSED secret-host'));
    const client = new HttpCompanyMediaClient(configuration());

    await expectApiError(
      client.verifyCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
      'MEDIA_SERVICE_UNAVAILABLE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it.each([
    [400, 'MEDIA_FILE_INVALID', HttpStatus.UNPROCESSABLE_ENTITY],
    [401, 'MEDIA_SERVICE_AUTH_FAILED', HttpStatus.SERVICE_UNAVAILABLE],
    [403, 'MEDIA_FILE_INVALID', HttpStatus.UNPROCESSABLE_ENTITY],
    [404, 'MEDIA_FILE_INVALID', HttpStatus.UNPROCESSABLE_ENTITY],
    [409, 'MEDIA_FILE_INVALID', HttpStatus.UNPROCESSABLE_ENTITY],
    [410, 'MEDIA_FILE_INVALID', HttpStatus.UNPROCESSABLE_ENTITY],
    [413, 'MEDIA_FILE_INVALID', HttpStatus.UNPROCESSABLE_ENTITY],
    [422, 'MEDIA_FILE_INVALID', HttpStatus.UNPROCESSABLE_ENTITY],
    [429, 'MEDIA_UPLOAD_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS],
    [500, 'MEDIA_SERVICE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE],
  ] as const)(
    'maps upstream status %s to a sanitized domain error',
    async (upstreamStatus, code, status) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'UPSTREAM_SECRET_CODE',
            message: 'do not expose this body',
          }),
          {
            status: upstreamStatus,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
      const client = new HttpCompanyMediaClient(configuration());

      await expectApiError(
        client.verifyCompanyFile(
          FILE_ID,
          COMPANY_ID,
          CompanyMediaAssetType.COMPANY_LOGO,
        ),
        code,
        status,
      );
    },
  );

  it('preserves upload-slot and delete conflicts for caller/worker retry', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: HttpStatus.CONFLICT,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new HttpCompanyMediaClient(configuration());

    await expectApiError(
      client.createCompanyUploadIntent(
        COMPANY_ID,
        USER_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
        'logo.jpg',
        'company-logo-upload-0001',
      ),
      'MEDIA_UPLOAD_CONFLICT',
      HttpStatus.CONFLICT,
    );

    fetchMock.mockResolvedValue(
      new Response('{}', {
        status: HttpStatus.CONFLICT,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expectApiError(
      client.deleteCompanyFile(
        FILE_ID,
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
      'MEDIA_DELETE_CONFLICT',
      HttpStatus.CONFLICT,
    );
  });

  it('rejects invalid identifiers and enum values before network I/O', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const client = new HttpCompanyMediaClient(configuration());

    await expectApiError(
      client.verifyCompanyFile(
        'not-a-file-id',
        COMPANY_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
      ),
      'MEDIA_REQUEST_INVALID',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    await expectApiError(
      client.verifyCompanyFile(
        FILE_ID,
        COMPANY_ID,
        'AVATAR' as CompanyMediaAssetType,
      ),
      'MEDIA_REQUEST_INVALID',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    await expectApiError(
      client.releaseReference('not-a-reference-id'),
      'MEDIA_REQUEST_INVALID',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
