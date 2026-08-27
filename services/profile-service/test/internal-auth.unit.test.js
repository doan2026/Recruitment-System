'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { InternalAuthService } = require(
  '../dist/common/auth/internal-auth.service',
);

const VALID_KEY = 'application-profile-contract-key-000000000001';
const config = (value) => ({
  get: (name) =>
    name === 'INTERNAL_API_KEY_APPLICATION' ? value : undefined,
});

test('InternalAuthService accepts only application-service with its exact key', () => {
  const service = new InternalAuthService(config(VALID_KEY));
  assert.doesNotThrow(() => service.assertConfiguration());
  assert.deepEqual(
    service.authenticate(VALID_KEY, 'application-service'),
    { service: 'application-service' },
  );

  const invalidHeaders = [
    [undefined, 'application-service'],
    [VALID_KEY, undefined],
    [VALID_KEY, 'Application-Service'],
    [VALID_KEY, 'profile-service'],
    [VALID_KEY.slice(0, -1) + 'x', 'application-service'],
    [[VALID_KEY], 'application-service'],
    [VALID_KEY, ['application-service']],
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
});
