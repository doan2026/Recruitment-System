'use strict';

const assert = require('node:assert/strict');
const {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} = require('node:crypto');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { NotificationType } = require('@prisma/client');
const {
  NotificationCursorService,
} = require('../dist/inbox/notification-cursor.service');
const {
  JwtVerifierService,
} = require('../dist/auth/jwt-verifier.service');
const {
  validateEnvironment,
} = require('../dist/config/environment');

const USER_ID = '70000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '70000000-0000-4000-8000-000000000002';
const NOTIFICATION_ID = '80000000-0000-4000-8000-000000000001';
const CURSOR_KEY = 'notification-test-cursor-key-0000000000000001';

const jwtConfig = (publicKey) => {
  const values = {
    JWT_PUBLIC_KEY: publicKey,
    JWT_ISSUER: 'https://auth.recruitment.local',
    JWT_AUDIENCE: 'recruitment-api',
  };
  return {
    get: (name) => values[name],
    getOrThrow: (name) => {
      if (values[name] === undefined) throw new Error(`${name} is missing`);
      return values[name];
    },
  };
};

const signingFixture = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const jwk = createPublicKey(publicPem).export({ format: 'jwk' });
  const kid = createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n }))
    .digest('base64url');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem,
    jwk: { ...jwk, alg: 'RS256', kid, use: 'sig' },
    kid,
  };
};

test('HMAC cursor binds user, filter and position', () => {
  const cursors = new NotificationCursorService(
    new ConfigService({ NOTIFICATION_CURSOR_HMAC_KEY: CURSOR_KEY }),
  );
  const encoded = cursors.encode(USER_ID, NotificationType.OFFER_RECEIVED, {
    createdAt: new Date('2026-08-28T12:00:00.000Z'),
    id: NOTIFICATION_ID,
  });
  assert.deepEqual(
    cursors.decode(encoded, USER_ID, NotificationType.OFFER_RECEIVED),
    {
      createdAt: new Date('2026-08-28T12:00:00.000Z'),
      id: NOTIFICATION_ID,
    },
  );
  assert.throws(
    () =>
      cursors.decode(
        encoded,
        OTHER_USER_ID,
        NotificationType.OFFER_RECEIVED,
      ),
    (error) => error.code === 'NOTIFICATION_CURSOR_SCOPE_MISMATCH',
  );
  assert.throws(
    () => cursors.decode(`${encoded.slice(0, -1)}x`, USER_ID, undefined),
    (error) => error.code === 'NOTIFICATION_CURSOR_INVALID',
  );
});

test('environment rejects placeholder cursor secrets and insecure JWKS', () => {
  const base = {
    DATABASE_URL: 'postgresql://notification:notification@db/test',
    JWT_ISSUER: 'https://auth.recruitment.local',
    JWT_AUDIENCE: 'recruitment-api',
    JWT_PUBLIC_KEY: 'public-key',
    NOTIFICATION_KAFKA_CONSUMER_ENABLED: 'false',
  };
  assert.throws(() =>
    validateEnvironment({
      ...base,
      NOTIFICATION_CURSOR_HMAC_KEY: 'replace-with-a-secret-000000000000000',
    }),
  );
  assert.throws(() =>
    validateEnvironment({
      ...base,
      JWT_PUBLIC_KEY: '',
      JWT_JWKS_URI: 'http://auth/jwks',
      NOTIFICATION_CURSOR_HMAC_KEY: CURSOR_KEY,
    }),
  );
});

test('environment requires a valid replay cutoff for an enabled consumer', () => {
  const base = {
    DATABASE_URL: 'postgresql://notification:notification@db/test',
    JWT_ISSUER: 'https://auth.recruitment.local',
    JWT_AUDIENCE: 'recruitment-api',
    JWT_PUBLIC_KEY: 'public-key',
    NOTIFICATION_CURSOR_HMAC_KEY: CURSOR_KEY,
    NOTIFICATION_KAFKA_CONSUMER_ENABLED: 'true',
    KAFKA_BROKERS: 'kafka:9092',
  };
  assert.throws(
    () => validateEnvironment(base),
    /NOTIFICATION_APPLICATION_REPLAY_AFTER is required/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        NOTIFICATION_APPLICATION_REPLAY_AFTER: '2026-02-31T00:00:00Z',
      }),
    /valid UTC instant/,
  );
  assert.equal(
    validateEnvironment({
      ...base,
      NOTIFICATION_APPLICATION_REPLAY_AFTER: '2026-08-28T00:00:00Z',
      NOTIFICATION_INTERVIEW_REPLAY_AFTER: '2026-08-28T00:00:00Z',
    }).NOTIFICATION_APPLICATION_REPLAY_AFTER,
    '2026-08-28T00:00:00.000Z',
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        NOTIFICATION_APPLICATION_REPLAY_AFTER: '2026-08-28T00:00:00Z',
      }),
    /NOTIFICATION_INTERVIEW_REPLAY_AFTER is required/,
  );
  assert.equal(
    validateEnvironment({
      ...base,
      NOTIFICATION_APPLICATION_REPLAY_AFTER: '2026-08-28T00:00:00Z',
      NOTIFICATION_INTERVIEW_REPLAY_AFTER: '2026-08-29T00:00:00Z',
    }).NOTIFICATION_INTERVIEW_REPLAY_AFTER,
    '2026-08-29T00:00:00.000Z',
  );
});

test('strict verifier accepts a complete RS256 token', async () => {
  const fixture = signingFixture();
  const config = jwtConfig(fixture.publicPem);
  const jwt = new JwtService();
  const verifier = new JwtVerifierService(config, jwt);
  const token = jwt.sign(
    { role: 'CANDIDATE' },
    {
      privateKey: fixture.privatePem,
      algorithm: 'RS256',
      subject: USER_ID,
      jwtid: randomUUID(),
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
      expiresIn: '15m',
      header: { kid: fixture.kid, typ: 'JWT' },
    },
  );
  assert.deepEqual(await verifier.verify(token), {
    id: USER_ID,
    systemRole: 'CANDIDATE',
  });
});

test('strict verifier rejects wrong typ and invalid jti', async () => {
  const fixture = signingFixture();
  const config = jwtConfig(fixture.publicPem);
  const jwt = new JwtService();
  const verifier = new JwtVerifierService(config, jwt);
  const wrongTyp = jwt.sign(
    { role: 'CANDIDATE' },
    {
      privateKey: fixture.privatePem,
      algorithm: 'RS256',
      subject: USER_ID,
      jwtid: randomUUID(),
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
      expiresIn: '15m',
      header: { kid: fixture.kid, typ: 'JOSE' },
    },
  );
  const invalidJti = jwt.sign(
    { role: 'CANDIDATE' },
    {
      privateKey: fixture.privatePem,
      algorithm: 'RS256',
      subject: USER_ID,
      jwtid: 'not-a-uuid',
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
      expiresIn: '15m',
      header: { kid: fixture.kid, typ: 'JWT' },
    },
  );
  await assert.rejects(() => verifier.verify(wrongTyp));
  await assert.rejects(() => verifier.verify(invalidJti));
});

test('JWKS refresh is single-flight and unknown kid respects cooldown', async () => {
  const fixture = signingFixture();
  const values = {
    JWT_JWKS_URI: 'https://auth.recruitment.local/jwks.json',
    JWT_ISSUER: 'https://auth.recruitment.local',
    JWT_AUDIENCE: 'recruitment-api',
    JWT_JWKS_REFRESH_COOLDOWN_MS: '10000',
  };
  const config = {
    get: (name) => values[name],
    getOrThrow: (name) => {
      if (values[name] === undefined) throw new Error(`${name} is missing`);
      return values[name];
    },
  };
  const jwt = new JwtService();
  const verifier = new JwtVerifierService(config, jwt);
  const token = (kid) =>
    jwt.sign(
      { role: 'CANDIDATE' },
      {
        privateKey: fixture.privatePem,
        algorithm: 'RS256',
        subject: USER_ID,
        jwtid: randomUUID(),
        issuer: values.JWT_ISSUER,
        audience: values.JWT_AUDIENCE,
        expiresIn: '15m',
        header: { kid, typ: 'JWT' },
      },
    );
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async (_uri, options) => {
    fetchCount += 1;
    assert.equal(options.redirect, 'error');
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      ok: true,
      json: async () => ({ keys: [fixture.jwk] }),
    };
  };
  try {
    await Promise.all([
      verifier.verify(token(fixture.kid)),
      verifier.verify(token(fixture.kid)),
    ]);
    await assert.rejects(() => verifier.verify(token('unknown-kid')));
    assert.equal(fetchCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('invalid JWKS JSON is reported as a service dependency failure', async () => {
  const fixture = signingFixture();
  const values = {
    JWT_JWKS_URI: 'https://auth.recruitment.local/jwks.json',
    JWT_ISSUER: 'https://auth.recruitment.local',
    JWT_AUDIENCE: 'recruitment-api',
  };
  const verifier = new JwtVerifierService(
    {
      get: (name) => values[name],
      getOrThrow: (name) => values[name],
    },
    new JwtService(),
  );
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError('bad JSON');
    },
  });
  const token = new JwtService().sign(
    { role: 'CANDIDATE' },
    {
      privateKey: fixture.privatePem,
      algorithm: 'RS256',
      subject: USER_ID,
      jwtid: randomUUID(),
      issuer: values.JWT_ISSUER,
      audience: values.JWT_AUDIENCE,
      expiresIn: '15m',
      header: { kid: fixture.kid, typ: 'JWT' },
    },
  );
  try {
    await assert.rejects(
      () => verifier.verify(token),
      (error) =>
        error.code === 'AUTH_KEY_INVALID' && error.getStatus?.() === 503,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
