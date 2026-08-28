'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { InternalAuthService } = require(
  '../dist/common/auth/internal-auth.service',
);

const APPLICATION_KEY = 'application-profile-contract-key-000000000001';
const JOB_SEARCH_KEY = 'job-search-profile-contract-key-0000000000001';
const config = (applicationKey, jobSearchKey = JOB_SEARCH_KEY) => ({
  get: (name) => ({
    INTERNAL_API_KEY_APPLICATION: applicationKey,
    INTERNAL_API_KEY_JOB_SEARCH: jobSearchKey,
  })[name],
});

test('InternalAuthService scopes distinct exact keys to allowed callers', () => {
  const service = new InternalAuthService(config(APPLICATION_KEY));
  assert.doesNotThrow(() => service.assertConfiguration());
  assert.deepEqual(
    service.authenticate(APPLICATION_KEY, 'application-service'),
    { service: 'application-service' },
  );
  assert.deepEqual(
    service.authenticate(
      JOB_SEARCH_KEY,
      'job-search-service',
      ['job-search-service'],
    ),
    { service: 'job-search-service' },
  );
  assert.throws(
    () => service.authenticate(JOB_SEARCH_KEY, 'job-search-service'),
    (error) =>
      error.getStatus() === 401 &&
      error.getResponse().code === 'INTERNAL_AUTH_INVALID',
  );
  assert.throws(
    () => service.authenticate(
      APPLICATION_KEY,
      'application-service',
      ['job-search-service'],
    ),
    (error) =>
      error.getStatus() === 401 &&
      error.getResponse().code === 'INTERNAL_AUTH_INVALID',
  );

  const invalidHeaders = [
    [undefined, 'application-service'],
    [APPLICATION_KEY, undefined],
    [APPLICATION_KEY, 'Application-Service'],
    [APPLICATION_KEY, 'profile-service'],
    [APPLICATION_KEY.slice(0, -1) + 'x', 'application-service'],
    [APPLICATION_KEY + ' ', 'application-service'],
    [[APPLICATION_KEY], 'application-service'],
    [APPLICATION_KEY, ['application-service']],
  ];
  for (const [key, caller] of invalidHeaders) {
    assert.throws(
      () => service.authenticate(key, caller),
      (error) =>
        error.getStatus() === 401 &&
        error.getResponse().code === 'INTERNAL_AUTH_INVALID',
    );
  }
});

test('InternalAuthService fails closed for missing, weak or unsafe configuration', () => {
  const invalidValues = [
    undefined,
    '',
    'short-key',
    'replace-with-a-real-application-key-000000000000',
    'safe-application-key-000000000000000\n',
    'safe-application-key-000000000000000\u0000',
    'safe-application-key-000000000000000\u007f',
  ];
  for (const value of invalidValues) {
    const service = new InternalAuthService(config(value));
    assert.throws(
      () => service.assertConfiguration(),
      (error) =>
        error.getStatus() === 503 &&
        error.getResponse().code === 'INTERNAL_AUTH_CONFIGURATION_ERROR',
    );
  }

  const duplicated = new InternalAuthService(
    config(APPLICATION_KEY, APPLICATION_KEY),
  );
  assert.throws(
    () => duplicated.assertConfiguration(),
    (error) =>
      error.getStatus() === 503 &&
      error.getResponse().code === 'INTERNAL_AUTH_CONFIGURATION_ERROR',
  );
});
