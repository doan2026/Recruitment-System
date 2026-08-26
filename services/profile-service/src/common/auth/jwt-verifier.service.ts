import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import {
  createHash,
  createPublicKey,
  KeyObject,
} from 'crypto';
import { readFileSync } from 'fs';
import { ApiException } from '../http/api-exception';
import { AuthUser } from './auth-user.interface';
import { SystemRole } from './system-role.enum';

interface AccessTokenClaims extends Record<string, unknown> {
  sub?: string;
  role?: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

interface JwtHeader {
  alg?: unknown;
  typ?: unknown;
  kid?: unknown;
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

interface StaticVerificationKey {
  kid: string;
  pem: string;
}

@Injectable()
export class JwtVerifierService {
  private readonly jwksKeys = new Map<string, string>();
  private jwksExpiresAt = 0;
  private jwksRefreshAllowedAt = 0;
  private staticKey?: StaticVerificationKey;

  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  assertConfiguration(): void {
    const jwksUri = this.config.get<string>('JWT_JWKS_URI')?.trim();
    if (!jwksUri) {
      this.getStaticPublicKey();
      return;
    }

    this.assertJwksUri(jwksUri);
  }

  async verify(token: string): Promise<AuthUser> {
    const header = this.readHeader(token);
    const options: JwtVerifyOptions = {
      secret: await this.getVerificationKey(header),
      algorithms: ['RS256'],
      issuer:
        this.config.get<string>('JWT_ISSUER')?.trim() ||
        'https://auth.recruitment.local',
      audience:
        this.config.get<string>('JWT_AUDIENCE')?.trim() ||
        'recruitment-api',
    };

    const claims =
      await this.jwtService.verifyAsync<AccessTokenClaims>(
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

  private async getVerificationKey(
    header: JwtHeader,
  ): Promise<string> {
    const keyId = header.kid as string;
    const jwksUri = this.config.get<string>('JWT_JWKS_URI')?.trim();
    if (jwksUri) {
      this.assertJwksUri(jwksUri);
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
    const now = Date.now();
    const cached = this.jwksKeys.get(keyId);
    if (cached && now < this.jwksExpiresAt) {
      return cached;
    }

    if (now < this.jwksRefreshAllowedAt) {
      if (!cached && this.jwksKeys.size > 0) {
        throw new Error(
          'JWT kid does not match a published JWKS key',
        );
      }
      throw new ApiException(
        'AUTH_KEY_UNAVAILABLE',
        'Auth Service JWKS refresh is cooling down',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.jwksRefreshAllowedAt =
      now + this.getJwksRefreshCooldown();

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

    const materialized = new Map<string, string>();
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
        const value = this.materializePublicKey(jwk);
        if (value.kid === jwk.kid) {
          materialized.set(jwk.kid, value.pem);
        }
      } catch {
        continue;
      }
    }

    if (materialized.size === 0) {
      throw new ApiException(
        'AUTH_KEY_INVALID',
        'Auth Service JWKS has no valid RS256 signing key',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.jwksKeys.clear();
    for (const [kid, pem] of materialized) {
      this.jwksKeys.set(kid, pem);
    }
    this.jwksExpiresAt = Date.now() + this.getJwksCacheTtl();

    const key = this.jwksKeys.get(keyId);
    if (!key) {
      throw new Error('JWT kid does not match a published JWKS key');
    }
    return key;
  }

  private assertJwksUri(jwksUri: string): void {
    try {
      const uri = new URL(jwksUri);
      const allowInsecure =
        this.config
          .get<string>('JWT_ALLOW_INSECURE_JWKS')
          ?.trim()
          .toLowerCase() === 'true';
      const protocolAllowed =
        uri.protocol === 'https:' ||
        (uri.protocol === 'http:' && allowInsecure);
      if (
        !protocolAllowed ||
        !uri.hostname ||
        uri.username ||
        uri.password
      ) {
        throw new Error('unsafe JWKS URI');
      }
    } catch {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT JWKS URI must use HTTPS unless insecure HTTP is explicitly enabled',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private getStaticPublicKey(): StaticVerificationKey {
    if (this.staticKey) {
      return this.staticKey;
    }

    const inline = this.config
      .get<string>('JWT_PUBLIC_KEY')
      ?.replace(/\\n/g, '\n')
      .trim();
    const path = this.config.get<string>('JWT_PUBLIC_KEY_PATH')?.trim();

    let pem: string;
    try {
      pem = inline || (path ? readFileSync(path, 'utf8').trim() : '');
    } catch {
      throw new ApiException(
        'AUTH_KEY_UNAVAILABLE',
        'JWT public key cannot be read',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!pem) {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT JWKS URI or public key must be configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const key = createPublicKey(pem);
      this.staticKey = this.materializeKeyObject(key);
      return this.staticKey;
    } catch {
      throw new ApiException(
        'AUTH_KEY_INVALID',
        'Configured JWT public key is invalid',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private materializePublicKey(jwk: Jwk): StaticVerificationKey {
    const key = createPublicKey({
      key: jwk,
      format: 'jwk',
    } as never);
    return this.materializeKeyObject(key);
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

  private getJwksCacheTtl(): number {
    const configured = Number(
      this.config.get<string>('JWT_JWKS_CACHE_TTL_MS'),
    );
    return Number.isFinite(configured) && configured >= 1000
      ? configured
      : 300_000;
  }

  private getJwksRefreshCooldown(): number {
    const configured = Number(
      this.config.get<string>('JWT_JWKS_REFRESH_COOLDOWN_MS'),
    );
    return Number.isFinite(configured) &&
      configured >= 1000 &&
      configured <= 60_000
      ? configured
      : 10_000;
  }
}
