import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
} from 'crypto';
import { JwtVerifierService } from './jwt-verifier.service';
import { SystemRole } from './system-role.enum';

const USER_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const TOKEN_ID = 'd11ad11a-8cd0-4ea5-9786-c0ec4955d9b6';
const JWT_ISSUER = 'https://auth.recruitment.local';
const JWT_AUDIENCE = 'recruitment-api';

describe('JwtVerifierService', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const publicJwk = createPublicKey(publicKey).export({ format: 'jwk' });
  const keyId = createHash('sha256')
    .update(
      JSON.stringify({
        e: publicJwk.e,
        kty: publicJwk.kty,
        n: publicJwk.n,
      }),
    )
    .digest('base64url');
  const jwtService = new JwtService();
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_PUBLIC_KEY') return publicKey;
      if (key === 'JWT_ISSUER') return JWT_ISSUER;
      if (key === 'JWT_AUDIENCE') return JWT_AUDIENCE;
      return undefined;
    }),
  } as unknown as ConfigService;
  const verifier = new JwtVerifierService(config, jwtService);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts an RS256 access token with valid sub and role claims', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: SystemRole.RECRUITER, jti: TOKEN_ID },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: keyId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).resolves.toMatchObject({
      id: USER_ID,
      systemRole: SystemRole.RECRUITER,
    });
  });

  it('loads the matching kid from JWKS and caches the public key', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              ...publicJwk,
              kid: keyId,
              use: 'sig',
              alg: 'RS256',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const jwksConfig = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_JWKS_URI') {
          return 'https://auth.example/.well-known/jwks.json';
        }
        if (key === 'JWT_JWKS_CACHE_TTL_MS') {
          return '300000';
        }
        if (key === 'JWT_ISSUER') return JWT_ISSUER;
        if (key === 'JWT_AUDIENCE') return JWT_AUDIENCE;
        return undefined;
      }),
    } as unknown as ConfigService;
    const jwksVerifier = new JwtVerifierService(jwksConfig, jwtService);
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: SystemRole.RECRUITER, jti: TOKEN_ID },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: keyId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '5m',
      },
    );

    await expect(jwksVerifier.verify(token)).resolves.toMatchObject({
      id: USER_ID,
      systemRole: SystemRole.RECRUITER,
    });
    await jwksVerifier.verify(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a token signed with a different algorithm', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: SystemRole.RECRUITER, jti: TOKEN_ID },
      {
        secret: 'not-the-rsa-private-key',
        algorithm: 'HS256',
        keyid: keyId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toBeDefined();
  });

  it('rejects missing or unsupported authorization claims', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: 'UNKNOWN', jti: TOKEN_ID },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: keyId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toThrow(
      'canonical contract',
    );
  });

  it('rejects a lowercase role even when the signature is valid', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: 'admin', jti: TOKEN_ID },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: keyId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toThrow(
      'canonical contract',
    );
  });

  it('rejects a token without a UUID v4 jti', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: SystemRole.ADMIN },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: keyId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toThrow(
      'canonical contract',
    );
  });

  it('rejects a static-key token whose kid is not the key thumbprint', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: SystemRole.ADMIN, jti: TOKEN_ID },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: 'untrusted-key-id',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toThrow(
      'kid does not match the configured public key',
    );
  });

  it('rejects a token issued for another audience', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: SystemRole.ADMIN, jti: TOKEN_ID },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: keyId,
        issuer: JWT_ISSUER,
        audience: 'another-service',
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toBeDefined();
  });

  it('fails closed when issuer or audience is not configured', async () => {
    const missingConfig = {
      get: jest.fn((key: string) =>
        key === 'JWT_PUBLIC_KEY' ? publicKey : undefined,
      ),
    } as unknown as ConfigService;
    const missingConfigVerifier = new JwtVerifierService(
      missingConfig,
      jwtService,
    );

    await expect(missingConfigVerifier.verify('unused')).rejects.toMatchObject({
      code: 'AUTH_CONFIGURATION_ERROR',
    });
  });
});
