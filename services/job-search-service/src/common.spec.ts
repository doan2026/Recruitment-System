import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './common';

function context(apiKey?: string): ExecutionContext {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: apiKey ? { 'x-internal-api-key': apiKey } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard internal service authentication', () => {
  function guard(): AuthGuard {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    return new AuthGuard(
      reflector,
      {} as JwtService,
      new ConfigService({ INTERNAL_API_KEY: 'shared-secret' }),
    );
  }

  it('accepts a matching internal API key', async () => {
    await expect(
      guard().canActivate(context('shared-secret')),
    ).resolves.toBe(true);
  });

  it('rejects a missing or incorrect internal API key', async () => {
    await expect(
      guard().canActivate(context('wrong-secret')),
    ).rejects.toMatchObject({ code: 'INVALID_INTERNAL_API_KEY' });
  });
});
