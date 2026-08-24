import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { createPublicKey } from 'crypto';
import { readFileSync } from 'fs';
import { ApiException } from '../errors/api-exception';
import { AuthUser } from './auth-user.interface';
import { SystemRole } from './system-role.enum';

interface AccessTokenClaims extends Record<string, unknown> {
  sub?: string;
  role?: string;
  iat?: number;
  exp?: number;
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
  kid?: unknown;
}

@Injectable()
export class JwtVerifierService {
  private staticPublicKey?: string;
  private readonly jwksKeys = new Map<string, string>();
  private jwksExpiresAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async verify(token: string): Promise<AuthUser> {
    const options: JwtVerifyOptions = {
      secret: await this.getVerificationKey(token),
      algorithms: ['RS256'],
    };
    const issuer = this.config.get<string>('JWT_ISSUER')?.trim();
    const audience = this.config.get<string>('JWT_AUDIENCE')?.trim();

    if (issuer) {
      options.issuer = issuer;
    }
    if (audience) {
      options.audience = audience;
    }

    const claims = await this.jwtService.verifyAsync<AccessTokenClaims>(
      token,
      options,
    );
    const role = claims.role?.toUpperCase() as SystemRole | undefined;

    if (
      !claims.sub ||
      !isUUID(claims.sub) ||
      !role ||
      !Object.values(SystemRole).includes(role) ||
      typeof claims.iat !== 'number' ||
      typeof claims.exp !== 'number' ||
      claims.exp <= claims.iat
    ) {
      throw new Error(
        'Access token does not contain valid sub, role, iat and exp claims',
      );
    }

    return {
      id: claims.sub,
      systemRole: role,
      claims,
    };
  }

  private async getVerificationKey(token: string): Promise<string> {
    const jwksUri = this.config.get<string>('JWT_JWKS_URI')?.trim();
    if (jwksUri) {
      return this.getJwksPublicKey(token, jwksUri);
    }

    return this.getStaticPublicKey();
  }

  private async getJwksPublicKey(
    token: string,
    jwksUri: string,
  ): Promise<string> {
    const keyId = this.readKeyId(token);
    const cachedKey = this.jwksKeys.get(keyId);

    if (cachedKey && Date.now() < this.jwksExpiresAt) {
      return cachedKey;
    }

    let response: Response;
    try {
      response = await fetch(jwksUri, {
        headers: { accept: 'application/json' },
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
        (jwk.use && jwk.use !== 'sig') ||
        (jwk.alg && jwk.alg !== 'RS256') ||
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
        const pem = keyObject
          .export({ type: 'spki', format: 'pem' })
          .toString();
        this.jwksKeys.set(jwk.kid, pem);
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

  private readKeyId(token: string): string {
    const encodedHeader = token.split('.')[0];
    if (!encodedHeader) {
      throw new Error('JWT header is missing');
    }

    let header: JwtHeader;
    try {
      header = JSON.parse(
        Buffer.from(encodedHeader, 'base64url').toString('utf8'),
      ) as JwtHeader;
    } catch {
      throw new Error('JWT header is invalid');
    }

    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      throw new Error('JWT header must contain RS256 alg and kid');
    }

    return header.kid;
  }

  private getJwksCacheTtl(): number {
    const configuredTtl = Number(
      this.config.get<string>('JWT_JWKS_CACHE_TTL_MS'),
    );
    return Number.isFinite(configuredTtl) && configuredTtl >= 1000
      ? configuredTtl
      : 300_000;
  }

  private getStaticPublicKey(): string {
    if (this.staticPublicKey) {
      return this.staticPublicKey;
    }

    const inlineKey = this.config
      .get<string>('JWT_PUBLIC_KEY')
      ?.replace(/\\n/g, '\n')
      .trim();

    if (inlineKey) {
      this.staticPublicKey = inlineKey;
      return this.staticPublicKey;
    }

    const keyPath = this.config.get<string>('JWT_PUBLIC_KEY_PATH')?.trim();
    if (!keyPath) {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT JWKS URI or public key must be configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      this.staticPublicKey = readFileSync(keyPath, 'utf8').trim();
    } catch {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT public key cannot be loaded',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!this.staticPublicKey) {
      throw new ApiException(
        'AUTH_CONFIGURATION_ERROR',
        'JWT public key is empty',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return this.staticPublicKey;
  }
}
