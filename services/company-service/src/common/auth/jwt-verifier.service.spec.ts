import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { JwtVerifierService } from './jwt-verifier.service';
import { SystemRole } from './system-role.enum';

const USER_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';

describe('JwtVerifierService', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const jwtService = new JwtService();
  const config = {
    get: jest.fn((key: string) =>
      key === 'JWT_PUBLIC_KEY' ? publicKey : undefined,
    ),
  } as unknown as ConfigService;
  const verifier = new JwtVerifierService(config, jwtService);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts an RS256 access token with valid sub and role claims', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: 'recruiter' },
      {
        privateKey,
        algorithm: 'RS256',
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).resolves.toMatchObject({
      id: USER_ID,
      systemRole: SystemRole.RECRUITER,
    });
  });

  it('loads the matching kid from JWKS and caches the public key', async () => {
    const keyId = 'auth-key-2026-08';
    const jwk = createPublicKey(publicKey).export({ format: 'jwk' });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              ...jwk,
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
        return undefined;
      }),
    } as unknown as ConfigService;
    const jwksVerifier = new JwtVerifierService(jwksConfig, jwtService);
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: SystemRole.RECRUITER },
      {
        privateKey,
        algorithm: 'RS256',
        keyid: keyId,
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
      { sub: USER_ID, role: SystemRole.RECRUITER },
      {
        secret: 'not-the-rsa-private-key',
        algorithm: 'HS256',
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toBeDefined();
  });

  it('rejects missing or unsupported authorization claims', async () => {
    const token = await jwtService.signAsync(
      { sub: USER_ID, role: 'UNKNOWN' },
      {
        privateKey,
        algorithm: 'RS256',
        expiresIn: '5m',
      },
    );

    await expect(verifier.verify(token)).rejects.toThrow(
      'valid sub, role, iat and exp claims',
    );
  });
});
