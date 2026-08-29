import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
} from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { performance } from 'perf_hooks';
import { SystemRole } from './auth.types';
import {
  AuthConfigurationError,
  AuthKeyUnavailableError,
  InvalidAccessTokenError,
  JwtVerifierService,
} from './jwt-verifier.service';

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const JWKS_URI = 'https://auth-service/auth/.well-known/jwks.json';
const USER_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const TOKEN_ID = 'd11ad11a-8cd0-4ea5-9786-c0ec4955d9b6';
const UNKNOWN_KID = 'dW5rbm93bi1rZXk';
const MAX_JWKS_BYTES = 32 * 1024;

interface CanonicalJwk {
  alg: 'RS256';
  e: string;
  kid: string;
  kty: 'RSA';
  n: string;
  use: 'sig';
}

interface SigningFixture {
  jwk: CanonicalJwk;
  kid: string;
  privateKey: string;
  publicKey: string;
}

interface TokenOptions {
  audience?: string | string[];
  expiresIn?: string | number | null;
  header?: Record<string, unknown>;
  issuer?: string;
  jwtid?: string | null;
  kid?: string;
  noTimestamp?: boolean;
  payload?: Record<string, unknown>;
  role?: unknown;
  subject?: string | null;
}

type Configuration = Record<string, unknown>;
type ExpectedError<T extends Error> = new () => T;

const jwt = new JwtService();

// Generate each key once. All tests reuse these immutable fixtures so the
// suite is deterministic and does not depend on repository or host keys.
const CURRENT = createSigningFixture(2048);
const PREVIOUS = createSigningFixture(2048);
const ROTATED = createSigningFixture(2048);
const WEAK = createSigningFixture(1024);

describe('JwtVerifierService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('verifies a canonical token with the configured static public key', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('static verification must not use the network'),
    );
    const verifier = staticVerifier({
      JWT_PUBLIC_KEY: CURRENT.publicKey.replace(/\n/g, '\\n'),
    });

    expect(() => verifier.onModuleInit()).not.toThrow();
    await expect(verifier.verify(signToken(CURRENT))).resolves.toEqual({
      id: USER_ID,
      systemRole: SystemRole.CANDIDATE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not misclassify an unexpected JWT runtime failure as an invalid token', async () => {
    const failure = new Error('unexpected verifier runtime failure');
    jest.spyOn(jwt, 'verifyAsync').mockRejectedValueOnce(failure);
    const verifier = staticVerifier();

    await expect(verifier.verify(signToken(CURRENT))).rejects.toBe(failure);
  });

  it('loads and caches a canonical static public key from its file path', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-jwt-verifier-'));
    const publicKeyPath = join(directory, 'jwt-public.pem');
    writeFileSync(publicKeyPath, CURRENT.publicKey, { mode: 0o600 });

    try {
      const verifier = staticVerifier({
        JWT_PUBLIC_KEY: undefined,
        JWT_PUBLIC_KEY_PATH: publicKeyPath,
      });

      expect(() => verifier.onModuleInit()).not.toThrow();
      await expect(verifier.verify(signToken(CURRENT))).resolves.toEqual({
        id: USER_ID,
        systemRole: SystemRole.CANDIDATE,
      });
      rmSync(publicKeyPath);
      await expect(verifier.verify(signToken(CURRENT))).resolves.toMatchObject({
        id: USER_ID,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ['missing key', { JWT_PUBLIC_KEY: undefined }],
    ['private key', { JWT_PUBLIC_KEY: CURRENT.privateKey }],
    ['weak RSA key', { JWT_PUBLIC_KEY: WEAK.publicKey }],
    ['invalid PEM', { JWT_PUBLIC_KEY: 'not-a-public-key' }],
  ])('rejects unsafe static configuration: %s', (_name, overrides) => {
    const verifier = staticVerifier(overrides);

    expect(() => verifier.onModuleInit()).toThrow(AuthConfigurationError);
  });

  it.each([
    [
      'inline public key and public-key path',
      { JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt-public.pem' },
    ],
    [
      'static public key and JWKS',
      {
        JWT_JWKS_ALLOWED_HOSTS: 'auth-service',
        JWT_JWKS_URI: JWKS_URI,
      },
    ],
  ])('rejects ambiguous key sources: %s', (_name, overrides) => {
    const verifier = staticVerifier(overrides);

    expect(() => verifier.onModuleInit()).toThrow(AuthConfigurationError);
  });

  it('loads current and previous JWKS keys once and serves both from cache', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jwksResponse([CURRENT.jwk, PREVIOUS.jwk], {
        'content-encoding': 'identity',
        'content-type': 'application/jwk-set+json; charset="utf-8"',
      }),
    );
    const verifier = jwksVerifier();

    await expect(verifier.verify(signToken(CURRENT))).resolves.toMatchObject({
      id: USER_ID,
    });
    await expect(
      verifier.verify(signToken(PREVIOUS, { role: SystemRole.RECRUITER })),
    ).resolves.toMatchObject({ systemRole: SystemRole.RECRUITER });
    await verifier.verify(signToken(CURRENT));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      JWKS_URI,
      expect.objectContaining({
        headers: {
          accept: 'application/json, application/jwk-set+json',
          'accept-encoding': 'identity',
          'cache-control': 'no-store',
        },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('shares one cold-start JWKS fetch across concurrent verification', async () => {
    let releaseFetch!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () => {
        await released;
        return jwksResponse([CURRENT.jwk]);
      },
    );
    const verifier = jwksVerifier();
    const token = signToken(CURRENT);

    const pending = Array.from({ length: 12 }, () => verifier.verify(token));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFetch();
    const users = await Promise.all(pending);
    expect(users).toHaveLength(12);
    expect(users.every((user) => user.id === USER_ID)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cooldown-limits unknown kid refreshes without blocking cached keys', async () => {
    let now = performance.now();
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () => jwksResponse([CURRENT.jwk]),
    );
    const verifier = jwksVerifier({
      JWT_JWKS_CACHE_TTL_MS: '5000',
      JWT_JWKS_REFRESH_COOLDOWN_MS: '1000',
    });
    const unknown = signToken(CURRENT, { kid: UNKNOWN_KID });

    await verifier.verify(signToken(CURRENT));
    await expectError(verifier.verify(unknown), InvalidAccessTokenError);
    await verifier.verify(signToken(CURRENT));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 1001;
    await expectError(verifier.verify(unknown), InvalidAccessTokenError);
    await expectError(verifier.verify(unknown), InvalidAccessTokenError);
    await verifier.verify(signToken(CURRENT));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never serves an expired cached key when JWKS refresh is unavailable', async () => {
    let now = performance.now();
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jwksResponse([CURRENT.jwk]))
      .mockRejectedValueOnce(
        new Error(`upstream leaked ${JWKS_URI} ${CURRENT.publicKey}`),
      );
    const verifier = jwksVerifier({
      JWT_JWKS_CACHE_TTL_MS: '1000',
      JWT_JWKS_REFRESH_COOLDOWN_MS: '1000',
    });
    const token = signToken(CURRENT);

    await verifier.verify(token);
    now += 1001;

    const first = await expectError(
      verifier.verify(token),
      AuthKeyUnavailableError,
    );
    const duringCooldown = await expectError(
      verifier.verify(token),
      AuthKeyUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.message).toBe('Auth signing keys are unavailable');
    expect(duringCooldown.message).toBe('Auth signing keys are unavailable');
    expect(first.message).not.toContain(JWKS_URI);
    expect(first.message).not.toContain('PUBLIC KEY');
  });

  it('uses a monotonic cache clock across wall-clock rollback and forward jumps', async () => {
    let wallNow = Date.now();
    let monotonicNow = performance.now();
    const token = signToken(CURRENT);
    jest.spyOn(Date, 'now').mockImplementation(() => wallNow);
    jest.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () => jwksResponse([CURRENT.jwk]),
    );
    const verifier = jwksVerifier({
      JWT_JWKS_CACHE_TTL_MS: '5000',
      JWT_JWKS_REFRESH_COOLDOWN_MS: '1000',
    });

    await verifier.verify(token);
    wallNow -= 1000;
    monotonicNow += 5001;
    await verifier.verify(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    wallNow += 7000;
    await verifier.verify(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes a rotated unknown kid and atomically removes unpublished keys', async () => {
    let now = performance.now();
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => jwksResponse([CURRENT.jwk]))
      .mockImplementationOnce(async () => jwksResponse([ROTATED.jwk]));
    const verifier = jwksVerifier();

    await verifier.verify(signToken(CURRENT));
    now += 1001;
    await expect(verifier.verify(signToken(ROTATED))).resolves.toMatchObject({
      id: USER_ID,
    });
    await expectError(
      verifier.verify(signToken(CURRENT)),
      InvalidAccessTokenError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last complete cache when a refresh document is malformed', async () => {
    let now = performance.now();
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const malformed = new Response(JSON.stringify({
      keys: [CURRENT.jwk, { ...ROTATED.jwk, extra: true }],
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => jwksResponse([CURRENT.jwk]))
      .mockResolvedValueOnce(malformed);
    const verifier = jwksVerifier();

    await verifier.verify(signToken(CURRENT));
    now += 1001;
    await expectError(
      verifier.verify(signToken(ROTATED)),
      AuthKeyUnavailableError,
    );
    await expect(verifier.verify(signToken(CURRENT))).resolves.toMatchObject({
      id: USER_ID,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['malformed compact token', () => 'not-a-jwt'],
    ['too many segments', () => 'a.b.c.d'],
    ['whitespace', () => `${signToken(CURRENT)} `],
    ['oversized token', () => `${'a'.repeat(8193)}.b.c`],
    [
      'invalid UTF-8 header',
      () => `${Buffer.from([0xff]).toString('base64url')}.e30.signature`,
    ],
    [
      'HS256 algorithm',
      () =>
        jwt.sign(
          { role: SystemRole.CANDIDATE },
          {
            algorithm: 'HS256',
            audience: AUDIENCE,
            expiresIn: '5m',
            header: { alg: 'HS256', kid: CURRENT.kid, typ: 'JWT' },
            issuer: ISSUER,
            jwtid: TOKEN_ID,
            secret: 'not-an-rsa-key-but-long-enough',
            subject: USER_ID,
          },
        ),
    ],
    [
      'wrong typ',
      () => replaceHeader(signToken(CURRENT), {
        alg: 'RS256', kid: CURRENT.kid, typ: 'JOSE',
      }),
    ],
    [
      'missing kid',
      () => replaceHeader(signToken(CURRENT), { alg: 'RS256', typ: 'JWT' }),
    ],
    [
      'non-base64url kid',
      () => replaceHeader(signToken(CURRENT), {
        alg: 'RS256', kid: 'unsafe kid', typ: 'JWT',
      }),
    ],
    [
      'oversized kid',
      () => replaceHeader(signToken(CURRENT), {
        alg: 'RS256', kid: 'a'.repeat(129), typ: 'JWT',
      }),
    ],
    [
      'extra protected header',
      () => replaceHeader(signToken(CURRENT), {
        alg: 'RS256', cty: 'JWT', kid: CURRENT.kid, typ: 'JWT',
      }),
    ],
  ])('rejects malformed or non-canonical token/header: %s', async (_name, make) => {
    const verifier = staticVerifier();
    const token = make();

    const error = await expectError(
      verifier.verify(token),
      InvalidAccessTokenError,
    );
    expect(error.message).toBe('Access token is invalid or expired');
    expect(error.message).not.toContain(token);
  });

  it.each([
    ['wrong signature', () => signToken(PREVIOUS, { kid: CURRENT.kid })],
    ['wrong issuer', () => signToken(CURRENT, { issuer: 'https://evil.invalid' })],
    ['wrong audience', () => signToken(CURRENT, { audience: 'other-api' })],
    ['array audience', () => signToken(CURRENT, { audience: [AUDIENCE] })],
    ['missing subject', () => signToken(CURRENT, { subject: null })],
    ['non-canonical subject', () => signToken(CURRENT, { subject: USER_ID.toUpperCase() })],
    ['non-v4 subject', () => signToken(CURRENT, {
      subject: '18c604a4-4be6-1c3d-85ea-c1f45daf17c8',
    })],
    ['missing jti', () => signToken(CURRENT, { jwtid: null })],
    ['non-v4 jti', () => signToken(CURRENT, {
      jwtid: 'd11ad11a-8cd0-1ea5-9786-c0ec4955d9b6',
    })],
    ['lowercase role', () => signToken(CURRENT, { role: 'candidate' })],
    ['unknown role', () => signToken(CURRENT, { role: 'OWNER' })],
    ['non-string role', () => signToken(CURRENT, { role: true })],
    ['expired token', () => signToken(CURRENT, { expiresIn: -1 })],
    ['missing iat', () => signToken(CURRENT, { noTimestamp: true })],
    ['missing exp', () => signToken(CURRENT, { expiresIn: null })],
    ['future iat', () => tokenWithTimes(61, 600)],
    ['fractional iat', () => tokenWithTimes(0.5, 600)],
    ['exp not after iat', () => tokenWithTimes(0, 0)],
  ])('rejects invalid signature or canonical claims: %s', async (_name, make) => {
    const verifier = staticVerifier();

    await expectError(verifier.verify(make()), InvalidAccessTokenError);
  });

  it.each([
    ['HTTP without opt-in', 'http://auth-service/auth/.well-known/jwks.json', {}],
    ['untrusted host', 'https://evil.invalid/auth/.well-known/jwks.json', {}],
    ['userinfo', 'https://user@auth-service/auth/.well-known/jwks.json', {}],
    ['password', 'https://user:secret@auth-service/auth/.well-known/jwks.json', {}],
    ['wrong path', 'https://auth-service/.well-known/jwks.json', {}],
    ['trailing slash', `${JWKS_URI}/`, {}],
    ['query', `${JWKS_URI}?next=evil`, {}],
    ['fragment', `${JWKS_URI}#keys`, {}],
    ['percent encoding', 'https://auth-service/auth/.well-known/%6awks.json', {}],
    ['backslash', 'https://auth-service/auth\\.well-known/jwks.json', {}],
    ['leading whitespace', ` ${JWKS_URI}`, {}],
    ['uppercase allowlist', JWKS_URI, { JWT_JWKS_ALLOWED_HOSTS: 'AUTH-SERVICE' }],
    ['duplicate allowlist', JWKS_URI, {
      JWT_JWKS_ALLOWED_HOSTS: 'auth-service,auth-service',
    }],
  ])('rejects unsafe JWKS URL configuration: %s', (_name, uri, overrides) => {
    const verifier = jwksVerifier({ JWT_JWKS_URI: uri, ...overrides });

    expect(() => verifier.onModuleInit()).toThrow(AuthConfigurationError);
  });

  it('allows the exact HTTP development endpoint only with explicit opt-in', () => {
    const verifier = jwksVerifier({
      JWT_ALLOW_INSECURE_JWKS: 'true',
      JWT_JWKS_URI: 'http://auth-service:8080/auth/.well-known/jwks.json',
    });

    expect(() => verifier.onModuleInit()).not.toThrow();
  });

  it('canonicalizes an explicitly allowlisted IPv6 JWKS hostname', () => {
    const verifier = jwksVerifier({
      JWT_JWKS_ALLOWED_HOSTS: '0:0:0:0:0:0:0:1',
      JWT_JWKS_URI: 'https://[::1]/auth/.well-known/jwks.json',
    });

    expect(() => verifier.onModuleInit()).not.toThrow();
  });

  it.each([
    [
      'redirect',
      () => new Response(null, {
        headers: { location: 'https://evil.invalid/keys' },
        status: 302,
      }),
    ],
    [
      'non-200 status',
      () => new Response('private upstream body', {
        headers: { 'content-type': 'application/json' },
        status: 503,
      }),
    ],
    [
      'missing content type',
      () => new Response(JSON.stringify({ keys: [CURRENT.jwk] }), {
        status: 200,
      }),
    ],
    [
      'HTML content type',
      () => new Response(JSON.stringify({ keys: [CURRENT.jwk] }), {
        headers: { 'content-type': 'text/html' },
        status: 200,
      }),
    ],
    [
      'unsupported charset',
      () => new Response(JSON.stringify({ keys: [CURRENT.jwk] }), {
        headers: { 'content-type': 'application/json; charset=latin1' },
        status: 200,
      }),
    ],
    [
      'compressed encoding',
      () => new Response(JSON.stringify({ keys: [CURRENT.jwk] }), {
        headers: {
          'content-encoding': 'gzip',
          'content-type': 'application/json',
        },
        status: 200,
      }),
    ],
    [
      'oversized declared length',
      () => new Response(JSON.stringify({ keys: [CURRENT.jwk] }), {
        headers: {
          'content-length': String(MAX_JWKS_BYTES + 1),
          'content-type': 'application/json',
        },
        status: 200,
      }),
    ],
    [
      'non-canonical declared length',
      () => new Response(JSON.stringify({ keys: [CURRENT.jwk] }), {
        headers: {
          'content-length': '032',
          'content-type': 'application/json',
        },
        status: 200,
      }),
    ],
  ])('rejects unsafe JWKS HTTP response: %s', async (_name, response) => {
    const upstream = response();
    const cancelSpy = upstream.body
      ? jest.spyOn(upstream.body, 'cancel')
      : undefined;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);

    await expectError(
      jwksVerifier().verify(signToken(CURRENT)),
      AuthKeyUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (cancelSpy) {
      expect(cancelSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('fails closed when the configured timeout aborts a stalled JWKS fetch', async () => {
    const controller = new AbortController();
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(
      controller.signal,
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('missing deadline signal'));
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
    );
    const pending = jwksVerifier().verify(signToken(CURRENT));

    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(new Error(`private timeout detail ${JWKS_URI}`));

    const error = await expectError(pending, AuthKeyUnavailableError);
    expect(timeoutSpy).toHaveBeenCalledWith(1000);
    expect(error.message).toBe('Auth signing keys are unavailable');
    expect(error.message).not.toContain(JWKS_URI);
  });

  it('enforces the raw streaming cap without trusting Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_JWKS_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );

    await expectError(
      jwksVerifier().verify(signToken(CURRENT)),
      AuthKeyUnavailableError,
    );
  });

  it.each([
    ['malformed JSON', () => '{"keys":'],
    ['invalid UTF-8', () => new Uint8Array([0xff])],
    ['array root', () => JSON.stringify([])],
    ['missing keys root', () => JSON.stringify({})],
    ['extra root field', () => JSON.stringify({ keys: [CURRENT.jwk], extra: true })],
    ['empty keys', () => JSON.stringify({ keys: [] })],
    ['too many keys', () => JSON.stringify({
      keys: Array.from({ length: 17 }, () => CURRENT.jwk),
    })],
    ['extra JWK field', () => JSON.stringify({
      keys: [{ ...CURRENT.jwk, x5c: ['certificate'] }],
    })],
    ['missing JWK field', () => JSON.stringify({
      keys: [{
        alg: CURRENT.jwk.alg,
        kid: CURRENT.jwk.kid,
        kty: CURRENT.jwk.kty,
        n: CURRENT.jwk.n,
        use: CURRENT.jwk.use,
      }],
    })],
    ['wrong key purpose', () => JSON.stringify({
      keys: [{ ...CURRENT.jwk, use: 'enc' }],
    })],
    ['weak RSA key', () => JSON.stringify({ keys: [WEAK.jwk] })],
    ['thumbprint mismatch', () => JSON.stringify({
      keys: [{ ...CURRENT.jwk, kid: PREVIOUS.kid }],
    })],
    ['duplicate kid', () => JSON.stringify({
      keys: [CURRENT.jwk, CURRENT.jwk],
    })],
    ['invalid exponent', () => JSON.stringify({
      keys: [{ ...CURRENT.jwk, e: 'Ag' }],
    })],
  ])('rejects malformed or non-canonical JWKS: %s', async (_name, body) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body(), {
        headers: { 'content-type': 'application/json; charset=utf8' },
        status: 200,
      }),
    );

    await expectError(
      jwksVerifier().verify(signToken(CURRENT)),
      AuthKeyUnavailableError,
    );
  });

  it('redacts token, PEM, JWKS URL and upstream failure details', async () => {
    const token = signToken(CURRENT);
    const secret = `private-upstream-body ${token} ${CURRENT.publicKey} ${JWKS_URI}`;
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(secret));

    const error = await expectError(
      jwksVerifier().verify(token),
      AuthKeyUnavailableError,
    );
    const rendered = `${error.name}: ${error.message}\n${error.stack ?? ''}`;

    expect(error.message).toBe('Auth signing keys are unavailable');
    expect(rendered).not.toContain(token);
    expect(rendered).not.toContain('private-upstream-body');
    expect(rendered).not.toContain(JWKS_URI);
    expect(rendered).not.toContain('BEGIN PUBLIC KEY');
  });

  it('redacts unsafe configuration values from startup errors', () => {
    const secretUri =
      'https://token:password@auth-service/auth/.well-known/jwks.json';
    const verifier = jwksVerifier({ JWT_JWKS_URI: secretUri });

    let caught: unknown;
    try {
      verifier.onModuleInit();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthConfigurationError);
    expect(String(caught)).not.toContain('token');
    expect(String(caught)).not.toContain('password');
    expect(String(caught)).not.toContain(secretUri);
  });
});

function createSigningFixture(modulusLength: number): SigningFixture {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const exported = createPublicKey(publicKey).export({ format: 'jwk' });
  if (exported.kty !== 'RSA' || !exported.n || !exported.e) {
    throw new Error('test RSA fixture could not be exported');
  }
  const kid = thumbprint(exported.n, exported.e);
  return {
    jwk: {
      alg: 'RS256',
      e: exported.e,
      kid,
      kty: 'RSA',
      n: exported.n,
      use: 'sig',
    },
    kid,
    privateKey,
    publicKey,
  };
}

function thumbprint(modulus: string, exponent: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ e: exponent, kty: 'RSA', n: modulus }), 'ascii')
    .digest('base64url');
}

function staticVerifier(overrides: Configuration = {}): JwtVerifierService {
  return new JwtVerifierService(
    configService({
      JWT_AUDIENCE: AUDIENCE,
      JWT_ISSUER: ISSUER,
      JWT_PUBLIC_KEY: CURRENT.publicKey,
      ...overrides,
    }),
    jwt,
  );
}

function jwksVerifier(overrides: Configuration = {}): JwtVerifierService {
  return new JwtVerifierService(
    configService({
      JWT_AUDIENCE: AUDIENCE,
      JWT_ISSUER: ISSUER,
      JWT_JWKS_ALLOWED_HOSTS: 'auth-service',
      JWT_JWKS_CACHE_TTL_MS: '5000',
      JWT_JWKS_REFRESH_COOLDOWN_MS: '1000',
      JWT_JWKS_TIMEOUT_MS: '1000',
      JWT_JWKS_URI: JWKS_URI,
      ...overrides,
    }),
    jwt,
  );
}

function configService(values: Configuration): ConfigService {
  return {
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService;
}

function signToken(
  fixture: SigningFixture,
  options: TokenOptions = {},
): string {
  const signOptions: Record<string, unknown> = {
    algorithm: 'RS256',
    audience: options.audience ?? AUDIENCE,
    header: {
      alg: 'RS256',
      kid: options.kid ?? fixture.kid,
      typ: 'JWT',
      ...options.header,
    },
    issuer: options.issuer ?? ISSUER,
    privateKey: fixture.privateKey,
  };
  if (options.subject !== null) {
    signOptions.subject = options.subject ?? USER_ID;
  }
  if (options.jwtid !== null) {
    signOptions.jwtid = options.jwtid ?? TOKEN_ID;
  }
  if (options.expiresIn !== null) {
    signOptions.expiresIn = options.expiresIn ?? '5m';
  }
  if (options.noTimestamp !== undefined) {
    signOptions.noTimestamp = options.noTimestamp;
  }
  return jwt.sign(
    { role: options.role ?? SystemRole.CANDIDATE, ...options.payload },
    signOptions as never,
  );
}

function tokenWithTimes(iatOffsetSeconds: number, expOffsetSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  return signToken(CURRENT, {
    expiresIn: null,
    payload: {
      exp: now + expOffsetSeconds,
      iat: now + iatOffsetSeconds,
    },
  });
}

function replaceHeader(
  token: string,
  header: Record<string, unknown>,
): string {
  const [, payload, signature] = token.split('.');
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${payload}.${signature}`;
}

function jwksResponse(
  keys: CanonicalJwk[],
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ keys }), {
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    status: 200,
  });
}

async function expectError<T extends Error>(
  operation: Promise<unknown>,
  expected: ExpectedError<T>,
): Promise<T> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(expected);
  return caught as T;
}
