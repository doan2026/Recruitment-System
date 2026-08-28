import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../errors/api-exception';
import { HttpCurrentAuthAccountClient } from './http-current-auth-account.client';
import { SystemRole } from './system-role.enum';

const USER_ID = '6625ada7-71aa-4901-aef7-800b8245fbb8';
const OTHER_USER_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature';
const CANONICAL_EMAIL = 'r\u00e9cruiter@example.com';

type JsonRecord = Record<string, unknown>;

const configuration = (
  overrides: Record<string, unknown> = {},
): ConfigService => {
  const values: Record<string, unknown> = {
    AUTH_SERVICE_ALLOWED_HOSTS: 'auth-service',
    AUTH_SERVICE_URL: 'http://auth-service:3001',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
};

const accountData = (overrides: JsonRecord = {}): JsonRecord => ({
  email: CANONICAL_EMAIL,
  id: USER_ID,
  role: SystemRole.RECRUITER,
  verified: true,
  ...overrides,
});

const authEnvelope = (
  data: unknown = accountData(),
  meta: unknown = {},
): JsonRecord => ({ data, meta });

const jsonResponse = (
  envelope: unknown = authEnvelope(),
  init: ResponseInit = {},
): Response =>
  new Response(JSON.stringify(envelope), {
    status: HttpStatus.OK,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const expectApiError = async (
  operation: Promise<unknown>,
  code: string,
  status: HttpStatus,
): Promise<ApiException> => {
  const error = await operation.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ApiException);
  expect(error).toMatchObject({ code });
  expect((error as ApiException).getStatus()).toBe(status);
  return error as ApiException;
};

describe('HttpCurrentAuthAccountClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gets the canonical Auth account with the bearer token and hardened fetch options', async () => {
    const signal = new AbortController().signal;
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(signal);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse());
    const client = new HttpCurrentAuthAccountClient(
      configuration({ AUTH_SERVICE_URL: ' http://auth-service:3001 ' }),
    );

    await expect(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
    ).resolves.toEqual({
      id: USER_ID,
      normalizedEmail: CANONICAL_EMAIL,
    });

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://auth-service:3001/auth/me',
      {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + ACCESS_TOKEN,
        },
        method: 'GET',
        redirect: 'error',
        signal,
      },
    );
  });

  it('accepts an allowlisted HTTPS origin and canonicalizes its host', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse());
    const client = new HttpCurrentAuthAccountClient(
      configuration({
        AUTH_SERVICE_ALLOWED_HOSTS:
          ' standby-auth.internal, AUTH-SERVICE.EXAMPLE ',
        AUTH_SERVICE_URL: ' HTTPS://Auth-Service.Example:3443 ',
      }),
    );

    await client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth-service.example:3443/auth/me',
      expect.any(Object),
    );
  });

  it('uses the safe internal Auth origin and allowlist defaults', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse());
    const client = new HttpCurrentAuthAccountClient(
      configuration({
        AUTH_SERVICE_ALLOWED_HOSTS: undefined,
        AUTH_SERVICE_URL: undefined,
      }),
    );

    await client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://auth-service:8080/auth/me',
      expect.any(Object),
    );
  });

  it.each([
    ['non-string URL', { AUTH_SERVICE_URL: 123 }],
    ['malformed URL', { AUTH_SERVICE_URL: 'not a URL' }],
    ['non-HTTP protocol', { AUTH_SERVICE_URL: 'ftp://auth-service' }],
    [
      'embedded credentials',
      { AUTH_SERVICE_URL: 'http://user:secret@auth-service:3001' },
    ],
    ['non-root path', { AUTH_SERVICE_URL: 'http://auth-service:3001/v1' }],
    ['query string', { AUTH_SERVICE_URL: 'http://auth-service:3001?x=1' }],
    ['fragment', { AUTH_SERVICE_URL: 'http://auth-service:3001#auth' }],
    [
      'host absent from allowlist',
      { AUTH_SERVICE_ALLOWED_HOSTS: 'other-auth.internal' },
    ],
    ['empty allowlist', { AUTH_SERVICE_ALLOWED_HOSTS: '' }],
    [
      'empty allowlist member',
      { AUTH_SERVICE_ALLOWED_HOSTS: 'auth-service,,other-auth' },
    ],
    ['wildcard allowlist member', { AUTH_SERVICE_ALLOWED_HOSTS: '*.internal' }],
    ['URL-shaped allowlist member', { AUTH_SERVICE_ALLOWED_HOSTS: 'https://auth-service' }],
    ['invalid allowlist hostname', { AUTH_SERVICE_ALLOWED_HOSTS: 'auth_service' }],
  ] as Array<[string, Record<string, unknown>]>) (
    'rejects an unsafe Auth Service origin: %s',
    (_caseName, overrides) => {
      expect(
        () =>
          new HttpCurrentAuthAccountClient(configuration(overrides)),
      ).toThrow(
        expect.objectContaining({
          code: 'AUTH_SERVICE_CONFIGURATION_ERROR',
        }),
      );
    },
  );

  it.each(['100', '10000'])(
    'accepts the bounded request timeout %s ms',
    async (configuredTimeout) => {
      const timeout = jest
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValue(new AbortController().signal);
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse());
      const client = new HttpCurrentAuthAccountClient(
        configuration({ AUTH_REQUEST_TIMEOUT_MS: configuredTimeout }),
      );

      await client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID);

      expect(timeout).toHaveBeenCalledWith(Number(configuredTimeout));
    },
  );

  it.each([
    100,
    '99',
    '10001',
    '3.5',
    '-100',
    'NaN',
    '  ',
    '9007199254740992',
  ])('rejects an invalid request timeout: %p', (value) => {
    expect(
      () =>
        new HttpCurrentAuthAccountClient(
          configuration({ AUTH_REQUEST_TIMEOUT_MS: value }),
        ),
    ).toThrow(
      expect.objectContaining({
        code: 'AUTH_SERVICE_CONFIGURATION_ERROR',
      }),
    );
  });

  it.each([
    '',
    'header.payload',
    'header.payload.signature.extra',
    'header.pay load.signature',
    'header.payload.sign+ature',
    'a'.repeat(8191) + '.b.c',
  ])('rejects a malformed access token before fetch: %p', async (token) => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const client = new HttpCurrentAuthAccountClient(configuration());

    await expectApiError(
      client.getCurrentRecruiter(token, USER_ID),
      'AUTH_ACCOUNT_INVALID',
      HttpStatus.UNAUTHORIZED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-uuid',
    '6625ada7-71aa-1901-aef7-800b8245fbb8',
    USER_ID.toUpperCase(),
  ])(
    'rejects an invalid expected subject before fetch: %p',
    async (expectedUserId) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, expectedUserId),
        'AUTH_ACCOUNT_INVALID',
        HttpStatus.UNAUTHORIZED,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [HttpStatus.UNAUTHORIZED, 'AUTH_ACCOUNT_INVALID', HttpStatus.UNAUTHORIZED],
    [HttpStatus.FORBIDDEN, 'AUTH_ACCOUNT_INACTIVE', HttpStatus.FORBIDDEN],
  ] as const)(
    'maps Auth status %s to the account-domain error %s',
    async (upstreamStatus, code, status) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'UPSTREAM_SECRET_CODE',
            message: 'secret upstream account detail',
          }),
          {
            status: upstreamStatus,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
      const client = new HttpCurrentAuthAccountClient(configuration());

      const error = await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        code,
        status,
      );

      expect(JSON.stringify(error.getResponse())).not.toContain('UPSTREAM');
      expect(JSON.stringify(error.getResponse())).not.toContain('secret');
    },
  );

  it.each([201, 302, 400, 404, 409, 429, 500, 502])(
    'maps non-200 Auth status %s to a sanitized unavailable error',
    async (upstreamStatus) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('upstream body must remain private', {
          status: upstreamStatus,
          headers: { 'content-type': 'text/plain' },
        }),
      );
      const client = new HttpCurrentAuthAccountClient(configuration());

      const error = await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'AUTH_SERVICE_UNAVAILABLE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );

      expect(error.getResponse()).toEqual({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        details: null,
        message: 'Auth Service is unavailable',
      });
    },
  );

  it('maps fetch failures to a sanitized 503', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connect ECONNREFUSED secret-auth-host'));
    const client = new HttpCurrentAuthAccountClient(configuration());

    const error = await expectApiError(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
      'AUTH_SERVICE_UNAVAILABLE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );

    expect(error.getResponse()).toEqual({
      code: 'AUTH_SERVICE_UNAVAILABLE',
      details: null,
      message: 'Auth Service is unavailable',
    });
    expect(JSON.stringify(error.getResponse())).not.toContain('secret-auth-host');
  });

  it.each([
    [
      'missing content type',
      () => new Response('{}', { status: HttpStatus.OK }),
    ],
    [
      'non-JSON content type',
      () =>
        new Response('{}', {
          status: HttpStatus.OK,
          headers: { 'content-type': 'text/plain' },
        }),
    ],
    [
      'JSON-compatible but non-canonical content type',
      () =>
        new Response('{}', {
          status: HttpStatus.OK,
          headers: { 'content-type': 'application/problem+json' },
        }),
    ],
    [
      'invalid JSON',
      () =>
        new Response('{not-json', {
          status: HttpStatus.OK,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      'non-object JSON',
      () =>
        new Response('[]', {
          status: HttpStatus.OK,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      'invalid UTF-8 JSON',
      () =>
        new Response(new Uint8Array([0xc3, 0x28]), {
          status: HttpStatus.OK,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      'missing body',
      () =>
        new Response(null, {
          status: HttpStatus.OK,
          headers: { 'content-type': 'application/json' },
        }),
    ],
  ] as Array<[string, () => Response]>)(
    'rejects malformed Auth JSON: %s',
    async (_caseName, response) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(response());
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'AUTH_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    },
  );

  it.each([
    [
      'non-JSON content type',
      () =>
        new Response('{}', {
          status: HttpStatus.OK,
          headers: { 'content-type': 'text/plain' },
        }),
    ],
    [
      'invalid declared length',
      () =>
        new Response(JSON.stringify(authEnvelope()), {
          status: HttpStatus.OK,
          headers: {
            'content-length': 'invalid',
            'content-type': 'application/json',
          },
        }),
    ],
  ] as Array<[string, () => Response]>)(
    'cancels the unread Auth body for %s',
    async (_caseName, createResponse) => {
      const response = createResponse();
      const cancel = jest.spyOn(response.body!, 'cancel');
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'AUTH_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('maps a mid-stream Auth body failure to a sanitized unavailable error', async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads === 1) {
          controller.enqueue(new TextEncoder().encode('{'));
          return;
        }
        controller.error(new Error('private stream failure'));
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, {
        status: HttpStatus.OK,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new HttpCurrentAuthAccountClient(configuration());

    const error = await expectApiError(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
      'AUTH_SERVICE_UNAVAILABLE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(JSON.stringify(error.getResponse())).not.toContain('private');
  });

  it.each(['invalid', '-1', '16385'])(
    'rejects invalid or oversized declared JSON length %p',
    async (contentLength) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(authEnvelope()), {
          status: HttpStatus.OK,
          headers: {
            'content-length': contentLength,
            'content-type': 'application/json',
          },
        }),
      );
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'AUTH_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    },
  );

  it('accepts exactly 16 KiB and rejects a streamed body above 16 KiB', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const serialized = JSON.stringify(authEnvelope());
    const bodyAtLimit = serialized + ' '.repeat(16 * 1024 - Buffer.byteLength(serialized));
    fetchMock.mockResolvedValue(
      new Response(bodyAtLimit, {
        status: HttpStatus.OK,
        headers: {
          'content-length': String(16 * 1024),
          'content-type': 'application/json; charset=utf-8',
        },
      }),
    );
    const client = new HttpCurrentAuthAccountClient(configuration());

    await expect(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
    ).resolves.toEqual({ id: USER_ID, normalizedEmail: CANONICAL_EMAIL });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 + 1));
        controller.enqueue(new Uint8Array(8 * 1024));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(
      new Response(stream, {
        status: HttpStatus.OK,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expectApiError(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
      'AUTH_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it.each([
    ['missing data', { meta: {} }],
    ['missing meta', { data: accountData() }],
    ['extra envelope key', { data: accountData(), meta: {}, extra: true }],
    ['array data', { data: [], meta: {} }],
    ['null data', { data: null, meta: {} }],
  ])('requires exact Auth envelope keys: %s', async (_caseName, envelope) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(envelope));
    const client = new HttpCurrentAuthAccountClient(configuration());

    await expectApiError(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
      'AUTH_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it.each([null, [], '', { traceId: 'private-trace' }])(
    'requires meta to be an empty object: %p',
    async (meta) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(authEnvelope(accountData(), meta)));
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'AUTH_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    },
  );

  it.each(['email', 'id', 'role', 'verified'])(
    'requires the account data key %s',
    async (missingKey) => {
      const data = accountData();
      delete data[missingKey];
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(authEnvelope(data)));
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'AUTH_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    },
  );

  it('rejects extra account data keys', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(authEnvelope(accountData({ displayName: 'Recruiter' }))),
      );
    const client = new HttpCurrentAuthAccountClient(configuration());

    await expectApiError(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
      'AUTH_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it.each([
    ['non-string subject', { id: 123 }],
    ['malformed subject', { id: 'not-a-uuid' }],
    ['non-v4 subject', { id: '6625ada7-71aa-1901-aef7-800b8245fbb8' }],
    ['non-canonical subject', { id: USER_ID.toUpperCase() }],
    ['different subject', { id: OTHER_USER_ID }],
  ])('requires an exact canonical v4 subject: %s', async (_caseName, values) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(authEnvelope(accountData(values))));
    const client = new HttpCurrentAuthAccountClient(configuration());

    await expectApiError(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
      'AUTH_SERVICE_BAD_RESPONSE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it.each([
    ['candidate role', { role: SystemRole.CANDIDATE }],
    ['admin role', { role: SystemRole.ADMIN }],
    ['mixed-case role', { role: 'Recruiter' }],
    ['non-string role', { role: 1 }],
    ['unverified account', { verified: false }],
    ['non-boolean verification', { verified: 'true' }],
  ])(
    'forbids an account that cannot accept invitations: %s',
    async (_caseName, values) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(authEnvelope(accountData(values))));
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'INVITATION_ACCEPTANCE_FORBIDDEN',
        HttpStatus.FORBIDDEN,
      );
    },
  );

  it.each([
    ['non-string', null],
    ['empty', ''],
    ['malformed', 'not-an-email'],
    ['multiple at signs', 'recruiter@@example.com'],
    ['leading whitespace', ' recruiter@example.com'],
    ['trailing whitespace', 'recruiter@example.com '],
    ['embedded whitespace', 'recruiter @example.com'],
    ['control character', 'recruiter\u0000@example.com'],
    ['line break', 'recruiter@example.com\n'],
    ['mixed case', 'Recruiter@example.com'],
    ['non-NFC', 're\u0301cruiter@example.com'],
    ['overlong', 'a'.repeat(309) + '@example.com'],
  ] as Array<[string, unknown]>)(
    'rejects a non-canonical account email: %s',
    async (_caseName, email) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          jsonResponse(authEnvelope(accountData({ email }))),
        );
      const client = new HttpCurrentAuthAccountClient(configuration());

      await expectApiError(
        client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
        'AUTH_SERVICE_BAD_RESPONSE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    },
  );

  it('preserves an NFC lowercase email that is intentionally NFKC-distinct', async () => {
    const compatibilityDistinctEmail = '\uff52ecruiter@example.com';
    expect(compatibilityDistinctEmail.normalize('NFC')).toBe(
      compatibilityDistinctEmail,
    );
    expect(compatibilityDistinctEmail.normalize('NFKC')).not.toBe(
      compatibilityDistinctEmail,
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        authEnvelope(accountData({ email: compatibilityDistinctEmail })),
      ),
    );
    const client = new HttpCurrentAuthAccountClient(configuration());

    await expect(
      client.getCurrentRecruiter(ACCESS_TOKEN, USER_ID),
    ).resolves.toEqual({
      id: USER_ID,
      normalizedEmail: compatibilityDistinctEmail,
    });
  });
});
