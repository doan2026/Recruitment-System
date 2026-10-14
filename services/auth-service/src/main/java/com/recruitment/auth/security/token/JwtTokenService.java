package com.recruitment.auth.security.token;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.recruitment.auth.config.properties.TokenProperties;
import com.recruitment.auth.model.AuthUser;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class JwtTokenService {
  public static final Duration ACCESS_TOKEN_LIFETIME = Duration.ofMinutes(15);

  private static final JOSEObjectType ACCESS_TOKEN_TYPE = JOSEObjectType.JWT;

  private final RsaTokenKeys keys;
  private final TokenProperties properties;

  public JwtTokenService(RsaTokenKeys keys, TokenProperties properties) {
    this.keys = Objects.requireNonNull(keys, "keys is required");
    this.properties = Objects.requireNonNull(properties, "properties is required");
  }

  public IssuedAccessToken issue(AuthUser user, Instant issuedAt) {
    Objects.requireNonNull(user, "user is required");
    Instant now = Objects.requireNonNull(issuedAt, "issuedAt is required");
    Instant expiresAt = now.plus(ACCESS_TOKEN_LIFETIME);
    JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
        .type(ACCESS_TOKEN_TYPE)
        .keyID(keys.activeKeyId())
        .build();
    JWTClaimsSet claims = new JWTClaimsSet.Builder()
        .issuer(properties.getIssuer())
        .subject(user.getId().toString())
        .audience(properties.getAudience())
        .claim("role", user.getRole().name())
        .issueTime(Date.from(now))
        .expirationTime(Date.from(expiresAt))
        .jwtID(UUID.randomUUID().toString())
        .build();
    SignedJWT token = new SignedJWT(header, claims);
    try {
      token.sign(new RSASSASigner(keys.activePrivateKey()));
    } catch (JOSEException exception) {
      throw new IllegalStateException("Unable to sign access token", exception);
    }
    return new IssuedAccessToken(token.serialize(), expiresAt);
  }

  public record IssuedAccessToken(String value, Instant expiresAt) {
    public IssuedAccessToken {
      if (value == null || value.isBlank()) {
        throw new IllegalArgumentException("access token is required");
      }
      Objects.requireNonNull(expiresAt, "expiresAt is required");
    }

    @Override
    public String toString() {
      return "IssuedAccessToken[value=<redacted>, expiresAt=" + expiresAt + "]";
    }
  }
}
