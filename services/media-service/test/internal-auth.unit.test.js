'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const {
  InternalAuthService,
} = require('../dist/common/auth/internal-auth.service');

const keys = {
  profile: 'profile-0123456789abcdef0123456789abcdef',
  company: 'company-0123456789abcdef0123456789abcdef',
  application: 'application-0123456789abcdef0123456789abcdef',
  chat: 'chat-0123456789abcdef0123456789abcdef',
  interview: 'interview-0123456789abcdef0123456789abcdef',
  ai: 'ai-0123456789abcdef0123456789abcdef',
};

const validConfig = {
  INTERNAL_API_KEY_PROFILE: keys.profile,
  INTERNAL_API_KEY_COMPANY: keys.company,
  INTERNAL_API_KEY_APPLICATION: keys.application,
  INTERNAL_API_KEY_CHAT: keys.chat,
  INTERNAL_API_KEY_INTERVIEW: keys.interview,
  INTERNAL_API_KEY_AI: keys.ai,
};

test('internal auth requires every per-service key to be non-placeholder', () => {
  assert.throws(() =>
    new InternalAuthService(
      new ConfigService({
        ...validConfig,
        INTERNAL_API_KEY_PROFILE: 'short',
      }),
    ).assertConfiguration(),
  );
  assert.throws(() =>
    new InternalAuthService(
      new ConfigService({
        ...validConfig,
        INTERNAL_API_KEY_COMPANY:
          'replace-with-a-distinct-company-service-key',
      }),
    ).assertConfiguration(),
  );
});

test('internal auth rejects duplicate keys before identity authentication', () => {
  const service = new InternalAuthService(
    new ConfigService({
      ...validConfig,
      INTERNAL_API_KEY_COMPANY: keys.profile,
    }),
  );
  assert.throws(() => service.assertConfiguration());
  assert.throws(() =>
    service.authenticate(keys.profile, 'profile-service'),
  );
});

test('internal auth binds a distinct key to the claimed service identity', () => {
  const service = new InternalAuthService(
    new ConfigService(validConfig),
  );
  assert.deepEqual(
    service.authenticate(keys.profile, 'profile-service'),
    { service: 'profile-service' },
  );
  assert.deepEqual(
    service.authenticate(keys.company, 'company-service'),
    { service: 'company-service' },
  );
  assert.throws(() =>
    service.authenticate(keys.profile, 'company-service'),
  );
  assert.throws(() =>
    service.authenticate(keys.profile, 'unknown-service'),
  );
});
