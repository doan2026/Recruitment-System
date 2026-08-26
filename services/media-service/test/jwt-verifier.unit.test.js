'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHash,
  generateKeyPairSync,
  randomUUID,
} = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const {
  JwtVerifierService,
} = require('../dist/common/auth/jwt-verifier.service');

test('JWKS cold-start refresh is single-flight for concurrent verification', async (t) => {
  const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = keyPair.privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  const publicJwk = keyPair.publicKey.export({
    format: 'jwk',
  });
  const kid = createHash('sha256')
    .update(
      JSON.stringify({
        e: publicJwk.e,
        kty: 'RSA',
        n: publicJwk.n,
      }),
    )
    .digest('base64url');
  const issuer = 'https://auth.recruitment.local';
  const audience = 'recruitment-api';
  const subject = '10000000-0000-4000-8000-000000000001';
  const jwt = new JwtService();
  const token = jwt.sign(
    {
      role: 'CANDIDATE',
      jti: randomUUID(),
    },
    {
      privateKey,
      algorithm: 'RS256',
      issuer,
      audience,
      subject,
      expiresIn: '15m',
      header: { alg: 'RS256', typ: 'JWT', kid },
    },
  );
  const verifier = new JwtVerifierService(
    new ConfigService({
      JWT_JWKS_URI: 'https://auth.recruitment.local/jwks.json',
      JWT_ISSUER: issuer,
      JWT_AUDIENCE: audience,
      JWT_JWKS_REFRESH_COOLDOWN_MS: '10000',
    }),
    jwt,
  );

  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  let releaseFetch;
  const fetchReleased = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    await fetchReleased;
    return new Response(
      JSON.stringify({
        keys: [
          {
            ...publicJwk,
            kid,
            use: 'sig',
            alg: 'RS256',
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  const pending = Array.from({ length: 12 }, () =>
    verifier.verify(token),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls, 1);
  releaseFetch();
  const users = await Promise.all(pending);
  assert.equal(fetchCalls, 1);
  assert.equal(users.every((user) => user.id === subject), true);
});
