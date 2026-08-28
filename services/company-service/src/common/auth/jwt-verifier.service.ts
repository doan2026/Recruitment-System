import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { createHash, createPublicKey, KeyObject } from 'crypto';
import { readFileSync } from 'fs';
import { ApiException } from '../errors/api-exception';
import { AuthUser } from './auth-user.interface';
import { SystemRole } from './system-role.enum';

interface AccessTokenClaims extends Record<string, unknown> {
  sub?: string;
  role?: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

interface Jwk {
  kid?: string;
  kty?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

interface JwksResponse {
  keys?: Jwk[];
}

interface JwtHeader {
  alg?: unknown;
  typ?: unknown;
  kid?: unknown;
}

interface StaticVerificationKey {
  kid: string;
  pem: string;
}

@Injectable()
export class JwtVerifierService {
  private staticKey?: StaticVerificationKey;
  private readonly jwksKeys = new Map<string, string>();
  private jwksExpiresAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async verify(token: string): Promise<AuthUser> {
    const issuer = this.config.get<string>('JWT_ISSUER')?.trim();
    const audience = this.config.get<string>('JWT_AUDIENCE')?.trim();

    if (!issuer || !audience) {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT issuer and audience must be configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const header = this.readHeader(token);
    const options: JwtVerifyOptions = {
      secret: await this.getVerificationKey(header),
      algorithms: ['RS256'],
      issuer,
      audience,
    };

    const claims = await this.jwtService.verifyAsync<AccessTokenClaims>(
      token,
      options,
    );
    const role = claims.role as SystemRole | undefined;
    const now = Math.floor(Date.now() / 1000);

    if (
      !claims.sub ||
      !isUUID(claims.sub, '4') ||
      !role ||
      !Object.values(SystemRole).includes(role) ||
      typeof claims.iat !== 'number' ||
      typeof claims.exp !== 'number' ||
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp) ||
      claims.iat > now + 60 ||
      claims.exp <= claims.iat ||
      !claims.jti ||
      !isUUID(claims.jti, '4')
    ) {
      throw new Error(
        'Access token claims do not match the canonical contract',
      );
    }

    return {
      id: claims.sub,
      systemRole: role,
      claims,
    };
  }

  private async getVerificationKey(header: JwtHeader): Promise<string> {
    const keyId = header.kid as string;
    const jwksUri = this.config.get<string>('JWT_JWKS_URI')?.trim();
    if (jwksUri) {
      return this.getJwksPublicKey(keyId, jwksUri);
    }

    const staticKey = this.getStaticPublicKey();
    if (staticKey.kid !== keyId) {
      throw new Error('JWT kid does not match the configured public key');
    }
    return staticKey.pem;
  }

  private async getJwksPublicKey(
    keyId: string,
    jwksUri: string,
  ): Promise<string> {
    const cachedKey = this.jwksKeys.get(keyId);

    if (cachedKey && Date.now() < this.jwksExpiresAt) {
      return cachedKey;
    }

    let response: Response;
    try {
      response = await fetch(jwksUri, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      throw new ApiException(
        'AUTH_KEY_UNAVAILABLE',
        'Auth Service JWKS endpoint is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!response.ok) {
      throw new ApiException(
        'AUTH_KEY_UNAVAILABLE',
        'Auth Service JWKS endpoint returned an error',
        HttpStatus.SERVICE_UNAVAILABLE,
        { status: response.status },
      );
    }

    let payload: JwksResponse;
    try {
      payload = (await response.json()) as JwksResponse;
    } catch {
      throw new ApiException(
        'AUTH_KEY_INVALID',
        'Auth Service returned an invalid JWKS document',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!Array.isArray(payload.keys)) {
      throw new ApiException(
        'AUTH_KEY_INVALID',
        'Auth Service JWKS document does not contain a keys array',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!payload.keys.every((key) => key && typeof key === 'object')) {
      throw new ApiException(
        'AUTH_KEY_INVALID',
        'Auth Service JWKS keys must be JSON objects',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.jwksKeys.clear();
    for (const jwk of payload.keys) {
      if (
        !jwk.kid ||
        jwk.kty !== 'RSA' ||
        jwk.use !== 'sig' ||
        jwk.alg !== 'RS256' ||
        !jwk.n ||
        !jwk.e
      ) {
        continue;
      }

      try {
        const keyObject = createPublicKey({
          key: jwk,
          format: 'jwk',
        } as never);
        const materialized = this.materializeKeyObject(keyObject);
        if (materialized.kid === jwk.kid) {
          this.jwksKeys.set(jwk.kid, materialized.pem);
        }
      } catch {
        continue;
      }
    }

    if (this.jwksKeys.size === 0) {
      throw new ApiException(
        'AUTH_KEY_INVALID',
        'Auth Service JWKS does not contain a valid RS256 key',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.jwksExpiresAt = Date.now() + this.getJwksCacheTtl();
    const publicKey = this.jwksKeys.get(keyId);
    if (!publicKey) {
      throw new Error('JWT kid does not match an active JWKS key');
    }

    return publicKey;
  }

  private readHeader(token: string): JwtHeader {
    const segments = token.split('.');
    if (segments.length !== 3 || !segments[0]) {
      throw new Error('JWT compact serialization is invalid');
    }

    let header: JwtHeader;
    try {
      header = JSON.parse(
        Buffer.from(segments[0], 'base64url').toString('utf8'),
      ) as JwtHeader;
    } catch {
      throw new Error('JWT header is invalid');
    }

    if (
      header.alg !== 'RS256' ||
      header.typ !== 'JWT' ||
      typeof header.kid !== 'string' ||
      !header.kid
    ) {
      throw new Error('JWT header must contain alg=RS256, typ=JWT and kid');
    }

    return header;
  }

  private getJwksCacheTtl(): number {
    const configuredTtl = Number(
      this.config.get<string>('JWT_JWKS_CACHE_TTL_MS'),
    );
    return Number.isFinite(configuredTtl) && configuredTtl >= 1000
      ? configuredTtl
      : 300_000;
  }

  private getStaticPublicKey(): StaticVerificationKey {
    if (this.staticKey) {
      return this.staticKey;
    }

    const inlineKey = this.config
      .get<string>('JWT_PUBLIC_KEY')
      ?.replace(/\\n/g, '\n')
      .trim();

    const keyPath = this.config.get<string>('JWT_PUBLIC_KEY_PATH')?.trim();
    if (!inlineKey && !keyPath) {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT JWKS URI or public key must be configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let pem: string;
    try {
      pem = inlineKey || readFileSync(keyPath as string, 'utf8').trim();
    } catch {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT public key cannot be loaded',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!pem) {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT public key is empty',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      this.staticKey = this.materializeKeyObject(createPublicKey(pem));
      return this.staticKey;
    } catch {
      throw new ApiException(
        'AUTH_KEY_INVALID',
        'Configured JWT public key is invalid',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private materializeKeyObject(key: KeyObject): StaticVerificationKey {
    if (
      key.asymmetricKeyType !== 'rsa' ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw new Error('JWT public key must be RSA with at least 2048 bits');
    }

    const jwk = key.export({ format: 'jwk' });
    if (!jwk.n || !jwk.e || jwk.kty !== 'RSA') {
      throw new Error('JWT RSA public key cannot be exported');
    }
    const thumbprint = JSON.stringify({
      e: jwk.e,
      kty: 'RSA',
      n: jwk.n,
    });
    return {
      kid: createHash('sha256')
        .update(thumbprint)
        .digest('base64url'),
      pem: key
        .export({ type: 'spki', format: 'pem' })
        .toString()
        .trim(),
    };
  }
}
