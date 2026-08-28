package com.recruitment.interview.config;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.proc.DefaultJOSEObjectTypeVerifier;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

@Configuration(proxyBeanMethods = false)
class JwtConfiguration {
  private static final int MINIMUM_RSA_BITS = 2048;
  private static final Duration CLOCK_SKEW = Duration.ofSeconds(60);
  private static final Set<String> ROLES = Set.of("CANDIDATE", "RECRUITER", "ADMIN");

  @Bean
  InterviewJwtProperties interviewJwtProperties(
      @Value("${JWT_PUBLIC_KEY_PATH:}") String publicKeyPath,
      @Value("${JWT_ISSUER:https://auth.recruitment.local}") String issuer,
      @Value("${JWT_AUDIENCE:recruitment-api}") String audience
  ) {
    return new InterviewJwtProperties(publicKeyPath, issuer, audience);
  }

  @Bean
  RSAPublicKey jwtPublicKey(
      InterviewJwtProperties properties,
      ResourceLoader resourceLoader
  ) {
    return readPublicKey(properties.publicKeyPath(), resourceLoader);
  }

  @Bean
  JwtDecoder jwtDecoder(
      RSAPublicKey publicKey,
      InterviewJwtProperties properties,
      Clock clock
  ) {
    String expectedKeyId = keyId(publicKey);
    DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
    processor.setJWSTypeVerifier(new DefaultJOSEObjectTypeVerifier<>(JOSEObjectType.JWT));
    // Spring validators below are the single source of truth for claim validation
    // and use the injected clock. Nimbus otherwise performs a second timestamp
    // check against the JVM clock before Spring receives the token.
    processor.setJWTClaimsSetVerifier((claims, context) -> { });
    processor.setJWSKeySelector((header, context) -> {
      if (!JWSAlgorithm.RS256.equals(header.getAlgorithm())
          || !expectedKeyId.equals(header.getKeyID())) {
        return List.of();
      }
      return List.of(publicKey);
    });

    NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
    JwtTimestampValidator timestamps = new JwtTimestampValidator(CLOCK_SKEW);
    timestamps.setClock(clock);
    OAuth2TokenValidator<Jwt> issuer = new JwtIssuerValidator(properties.issuer());
    OAuth2TokenValidator<Jwt> contract = token ->
        validateContract(token, properties, expectedKeyId, clock);
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(timestamps, issuer, contract));
    return decoder;
  }

  @Bean
  @ConditionalOnMissingBean(Clock.class)
  Clock systemClock() {
    return Clock.systemUTC();
  }

  private static OAuth2TokenValidatorResult validateContract(
      Jwt token,
      InterviewJwtProperties properties,
      String expectedKeyId,
      Clock clock
  ) {
    if (!token.getAudience().equals(List.of(properties.audience()))) {
      return invalid("JWT audience is invalid");
    }
    if (token.getIssuedAt() == null || token.getExpiresAt() == null) {
      return invalid("JWT iat and exp claims are required");
    }
    if (token.getIssuedAt().isAfter(clock.instant().plus(CLOCK_SKEW))) {
      return invalid("JWT iat is in the future");
    }
    if (!token.getExpiresAt().isAfter(token.getIssuedAt())) {
      return invalid("JWT exp must be after iat");
    }
    if (!token.getExpiresAt().isAfter(clock.instant())) {
      return invalid("JWT is expired");
    }
    if (!isCanonicalVersionFourUuid(token.getSubject())
        || !isCanonicalVersionFourUuid(token.getId())) {
      return invalid("JWT sub and jti must be canonical UUIDv4 values");
    }
    Object role = token.getClaims().get("role");
    if (!(role instanceof String roleName) || !ROLES.contains(roleName)) {
      return invalid("JWT role must be one exact supported role string");
    }
    if (!expectedKeyId.equals(token.getHeaders().get("kid"))) {
      return invalid("JWT kid is invalid");
    }
    return OAuth2TokenValidatorResult.success();
  }

  private static boolean isCanonicalVersionFourUuid(String value) {
    try {
      UUID parsed = UUID.fromString(value);
      return parsed.version() == 4
          && parsed.variant() == 2
          && parsed.toString().equals(value);
    } catch (RuntimeException exception) {
      return false;
    }
  }

  private static RSAPublicKey readPublicKey(
      String location,
      ResourceLoader resourceLoader
  ) {
    String pem = readText(location, resourceLoader);
    String begin = "-----BEGIN PUBLIC KEY-----";
    String end = "-----END PUBLIC KEY-----";
    String trimmed = pem.trim();
    if (!trimmed.startsWith(begin) || !trimmed.endsWith(end)) {
      throw new IllegalStateException(
          "JWT public key must be an X.509 PEM public key: " + location);
    }
    String body = trimmed.substring(begin.length(), trimmed.length() - end.length());
    if (body.contains("-----BEGIN") || body.contains("-----END")) {
      throw new IllegalStateException("Unexpected PEM content in JWT public key: " + location);
    }
    try {
      byte[] der = Base64.getDecoder().decode(body.replaceAll("\\s", ""));
      RSAPublicKey publicKey = (RSAPublicKey) KeyFactory.getInstance("RSA")
          .generatePublic(new X509EncodedKeySpec(der));
      if (publicKey.getModulus().bitLength() < MINIMUM_RSA_BITS) {
        throw new IllegalStateException("JWT RSA public key must be at least 2048 bits");
      }
      return publicKey;
    } catch (GeneralSecurityException | ClassCastException | IllegalArgumentException exception) {
      throw new IllegalStateException(
          "JWT public key must be a valid X.509 RSA public key: " + location,
          exception);
    }
  }

  private static String readText(String location, ResourceLoader resourceLoader) {
    try {
      if (location.startsWith("classpath:") || location.startsWith("file:")) {
        Resource resource = resourceLoader.getResource(location);
        try (var input = resource.getInputStream()) {
          return new String(input.readAllBytes(), StandardCharsets.US_ASCII);
        }
      }
      return Files.readString(Path.of(location), StandardCharsets.US_ASCII);
    } catch (IOException | RuntimeException exception) {
      throw new IllegalStateException("Unable to read JWT public key: " + location, exception);
    }
  }

  static String keyId(RSAPublicKey publicKey) {
    try {
      return new RSAKey.Builder(publicKey).build().computeThumbprint().toString();
    } catch (JOSEException exception) {
      throw new IllegalStateException("Unable to compute JWT public-key thumbprint", exception);
    }
  }

  private static OAuth2TokenValidatorResult invalid(String description) {
    return OAuth2TokenValidatorResult.failure(
        new OAuth2Error("invalid_token", description, null));
  }
}
