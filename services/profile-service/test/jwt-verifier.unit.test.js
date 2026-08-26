'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} = require('node:crypto');
const { JwtService } = require('@nestjs/jwt');

const { JwtVerifierService } = require(
  '../dist/common/auth/jwt-verifier.service',
);

const createConfig = (values) => ({
  get: (key) => values[key],
});

const createSigningFixture = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicKeyPem = publicKey.export({
    type: 'spki',
    format: 'pem',
  });
  const jwk = createPublicKey(publicKeyPem).export({ format: 'jwk' });
  const kid = createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n }))
    .digest('base64url');
  return {
    privateKeyPem: privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
    jwk: { ...jwk, alg: 'RS256', kid, use: 'sig' },
    kid,
  };
};

test('JWT readiness rejects a missing verification source', () => {
  const verifier = new JwtVerifierService(
    createConfig({}),
    new JwtService(),
  );

  assert.throws(
    () => verifier.assertConfiguration(),
    (error) => error.getStatus?.() === 503,
  );
});

test('HTTP JWKS requires an explicit insecure-development opt-in', () => {
  const uri = 'http://auth-service:8080/auth/.well-known/jwks.json';
  const rejected = new JwtVerifierService(
    createConfig({ JWT_JWKS_URI: uri }),
    new JwtService(),
  );
  assert.throws(
    () => rejected.assertConfiguration(),
    (error) => error.getStatus?.() === 503,
  );

  const allowed = new JwtVerifierService(
    createConfig({
      JWT_ALLOW_INSECURE_JWKS: 'true',
      JWT_JWKS_URI: uri,
    }),
    new JwtService(),
  );
  assert.doesNotThrow(() => allowed.assertConfiguration());
});

test('JWKS cache cooldown prevents unknown-kid refresh amplification', async () => {
  const fixture = createSigningFixture();
  const jwt = new JwtService();
  const verifier = new JwtVerifierService(
    createConfig({
      JWT_AUDIENCE: 'recruitment-api',
      JWT_ISSUER: 'https://auth.recruitment.local',
      JWT_JWKS_CACHE_TTL_MS: '300000',
      JWT_JWKS_REFRESH_COOLDOWN_MS: '10000',
      JWT_JWKS_URI: 'https://auth.recruitment.local/jwks.json',
    }),
    jwt,
  );
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async (_uri, options) => {
    fetchCount += 1;
    assert.equal(options.redirect, 'error');
    return {
      ok: true,
      json: async () => ({ keys: [fixture.jwk] }),
    };
  };

  const token = (kid) =>
    jwt.sign(
      { role: 'CANDIDATE' },
      {
        algorithm: 'RS256',
        audience: 'recruitment-api',
        expiresIn: '15m',
        header: { kid, typ: 'JWT' },
        issuer: 'https://auth.recruitment.local',
        jwtid: randomUUID(),
        privateKey: fixture.privateKeyPem,
        subject: randomUUID(),
      },
    );

  try {
    await verifier.verify(token(fixture.kid));
    await assert.rejects(() => verifier.verify(token('unknown-kid')));
    await verifier.verify(token(fixture.kid));
    assert.equal(fetchCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
