import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobSearchInternalGuard } from './job-search-internal.guard';

const KEY = 'job-search-to-company-internal-key-0001';

const guardWith = (key: string | undefined) =>
  new JobSearchInternalGuard({
    get: () => key,
  } as unknown as ConfigService);

const contextWith = (header: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-internal-api-key': header } }),
    }),
  }) as unknown as ExecutionContext;

describe('JobSearchInternalGuard', () => {
  it('accepts the exact scoped key', () => {
    expect(guardWith(KEY).canActivate(contextWith(KEY))).toBe(true);
  });

  it.each([
    ['a missing header', undefined],
    ['a wrong key', `${KEY.slice(0, -1)}2`],
    ['a key of another length', `${KEY}x`],
    ['a repeated header', [KEY, KEY]],
  ])('rejects %s with 401', (_, header) => {
    expect(() => guardWith(KEY).canActivate(contextWith(header))).toThrow(
      expect.objectContaining({
        code: 'INVALID_INTERNAL_API_KEY',
        status: HttpStatus.UNAUTHORIZED,
      }),
    );
  });

  it.each([
    ['unset', undefined],
    ['too short', 'short-key'],
    ['the .env.example placeholder', 'replace-with-a-distinct-job-search-to-company-key'],
    ['padded', ` ${KEY} `],
  ])('fails closed with 503 when the key is %s', (_, key) => {
    expect(() => guardWith(key).canActivate(contextWith(key))).toThrow(
      expect.objectContaining({
        code: 'INTERNAL_API_KEY_NOT_CONFIGURED',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      }),
    );
  });
});
