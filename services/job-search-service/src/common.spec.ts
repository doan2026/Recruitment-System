import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiException, AuthGuard, SystemRole } from './common';
import {
  AuthConfigurationError,
  AuthKeyUnavailableError,
  InvalidAccessTokenError,
  JwtVerifierService,
} from './jwt-verifier.service';

const TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleSJ9.eyJzdWIiOiJjYW5kaWRhdGUifQ.signature';

interface TestRequest {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
  user?: unknown;
}

interface GuardHarness {
  guard: AuthGuard;
  verify: jest.MockedFunction<JwtVerifierService['verify']>;
}

function context(request: TestRequest): ExecutionContext {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function harness(options?: {
  internal?: boolean;
  publicRoute?: boolean;
}): GuardHarness {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === 'isInternal') return options?.internal ?? false;
      if (key === 'isPublic') return options?.publicRoute ?? false;
      return undefined;
    }),
  } as unknown as Reflector;
  const verifier = {
    verify: jest.fn(),
  } as unknown as JwtVerifierService;

  return {
    guard: new AuthGuard(
      reflector,
      verifier,
      new ConfigService({ INTERNAL_API_KEY: 'shared-secret' }),
    ),
    verify: verifier.verify as jest.MockedFunction<
      JwtVerifierService['verify']
    >,
  };
}

function bearerRequest(value = `Bearer ${TOKEN}`): TestRequest {
  return {
    headers: { authorization: value },
    rawHeaders: ['Host', 'localhost', 'Authorization', value],
  };
}

async function rejected<T extends HttpException = ApiException>(
  guard: AuthGuard,
  request: TestRequest,
): Promise<T> {
  try {
    await guard.canActivate(context(request));
    throw new Error('Expected AuthGuard to reject the request');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as T;
  }
}

describe('AuthGuard', () => {
  describe('metadata bypasses', () => {
    it('accepts a matching internal API key without reading a bearer token', async () => {
      const { guard, verify } = harness({
        internal: true,
        publicRoute: true,
      });
      const request: TestRequest = {
        headers: { 'x-internal-api-key': 'shared-secret' },
        rawHeaders: [
          'Authorization',
          `Bearer ${TOKEN}`,
          'Authorization',
          `Bearer ${TOKEN}`,
        ],
      };

      await expect(guard.canActivate(context(request))).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });

    it('rejects an incorrect internal API key without calling the verifier', async () => {
      const { guard, verify } = harness({ internal: true });
      const request: TestRequest = {
        headers: { 'x-internal-api-key': 'wrong-secret' },
      };

      await expect(guard.canActivate(context(request))).rejects.toMatchObject({
        code: 'INVALID_INTERNAL_API_KEY',
      });
      expect(verify).not.toHaveBeenCalled();
    });

    it('allows a public route without requiring raw headers', async () => {
      const { guard, verify } = harness({ publicRoute: true });

      await expect(
        guard.canActivate(context({ headers: {} })),
      ).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe('Authorization header parsing', () => {
    it.each([
      ['missing raw headers', { headers: { authorization: `Bearer ${TOKEN}` } }],
      ['missing Authorization', { headers: {}, rawHeaders: ['Host', 'localhost'] }],
      ['empty value', bearerRequest('')],
      ['multiple spaces', bearerRequest(`Bearer  ${TOKEN}`)],
      ['tab separator', bearerRequest(`Bearer\t${TOKEN}`)],
      ['wrong scheme', bearerRequest(`Token ${TOKEN}`)],
      ['two compact segments', bearerRequest('Bearer header.payload')],
      ['empty compact segment', bearerRequest('Bearer header..signature')],
      ['non-base64url character', bearerRequest('Bearer header.pay+load.signature')],
      [
        'oversized header',
        bearerRequest(`Bearer ${'a'.repeat(8192)}.b.c`),
      ],
    ] satisfies Array<[string, TestRequest]>) (
      'rejects %s before invoking the verifier',
      async (_label, request) => {
        const { guard, verify } = harness();

        const error = await rejected(guard, request);

        expect(error.code).toBe('UNAUTHORIZED');
        expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(verify).not.toHaveBeenCalled();
      },
    );

    it('rejects duplicate raw Authorization headers before verification', async () => {
      const { guard, verify } = harness();
      const request = bearerRequest();
      request.rawHeaders?.push('authorization', `Bearer ${TOKEN}`);

      const error = await rejected(guard, request);

      expect(error.code).toBe('UNAUTHORIZED');
      expect(verify).not.toHaveBeenCalled();
    });

    it('accepts a single case-insensitive Bearer scheme with one ASCII space', async () => {
      const { guard, verify } = harness();
      const user = {
        id: '50f8a7f5-75ff-4500-ae66-31b189a527fb',
        systemRole: SystemRole.CANDIDATE,
      };
      const request = bearerRequest(`bearer ${TOKEN}`);
      verify.mockResolvedValue(user);

      await expect(guard.canActivate(context(request))).resolves.toBe(true);

      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledWith(TOKEN);
      expect(request.user).toEqual(user);
    });

    it('allows a compact token of exactly 8 KiB', async () => {
      const { guard, verify } = harness();
      const token = `${'a'.repeat(8188)}.b.c`;
      const request = bearerRequest(`Bearer ${token}`);
      verify.mockResolvedValue({
        id: '50f8a7f5-75ff-4500-ae66-31b189a527fb',
        systemRole: SystemRole.CANDIDATE,
      });

      await expect(guard.canActivate(context(request))).resolves.toBe(true);

      expect(Buffer.byteLength(token, 'ascii')).toBe(8 * 1024);
      expect(verify).toHaveBeenCalledWith(token);
    });
  });

  describe('verifier error mapping', () => {
    it('maps InvalidAccessTokenError to a generic 401 without leaking the token', async () => {
      const { guard, verify } = harness();
      verify.mockRejectedValue(new InvalidAccessTokenError());

      const error = await rejected(guard, bearerRequest());

      expect(error).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Access token is invalid or expired',
      });
      expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(error.message).not.toContain(TOKEN);
    });

    it('maps an unexpected verifier error to a sanitized 500', async () => {
      const { guard, verify } = harness();
      const cause = new Error(`programming failure involving ${TOKEN}`);
      verify.mockRejectedValue(cause);

      const error = await rejected<InternalServerErrorException>(
        guard,
        bearerRequest(),
      );

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(error.message).toBe('Internal Server Error');
      expect(error.message).not.toContain(TOKEN);
      expect(error.message).not.toContain(cause.message);
    });

    it.each([
      [
        new AuthKeyUnavailableError(),
        'AUTH_KEY_UNAVAILABLE',
        'Access token verification key is temporarily unavailable',
      ],
      [
        new AuthConfigurationError(),
        'AUTH_CONFIGURATION_ERROR',
        'Access token verification is not configured',
      ],
    ])(
      'maps an operational verifier failure to sanitized 503 %s',
      async (cause, code, message) => {
        const { guard, verify } = harness();
        verify.mockRejectedValue(cause);

        const error = await rejected(guard, bearerRequest());

        expect(error).toMatchObject({ code, message });
        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(error.message).not.toContain(TOKEN);
      },
    );
  });
});
