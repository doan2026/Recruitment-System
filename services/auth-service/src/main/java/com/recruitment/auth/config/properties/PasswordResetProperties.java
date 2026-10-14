package com.recruitment.auth.config.properties;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth.password-reset")
public record PasswordResetProperties(
    String hmacSecret,
    Duration ttl,
    Duration claimTtl,
    Duration requestWindow,
    int maxRequests,
    String frontendResetUri) {
  public static final Duration TOKEN_TTL = Duration.ofMinutes(15);
  public static final Duration DEFAULT_CLAIM_TTL = Duration.ofSeconds(30);
  public static final Duration REQUEST_WINDOW = Duration.ofHours(1);
  public static final int MAX_REQUESTS = 3;

  private static final int MINIMUM_HMAC_SECRET_BYTES = 32;

  public PasswordResetProperties {
    if (hmacSecret == null
        || hmacSecret.isBlank()
        || hmacSecret.getBytes(StandardCharsets.UTF_8).length < MINIMUM_HMAC_SECRET_BYTES) {
      throw new IllegalArgumentException(
          "auth.password-reset.hmac-secret must contain at least 32 UTF-8 bytes");
    }
    if (!TOKEN_TTL.equals(ttl)) {
      throw new IllegalArgumentException("auth.password-reset.ttl must be exactly PT15M");
    }
    claimTtl = requireClaimTtl(claimTtl);
    if (!REQUEST_WINDOW.equals(requestWindow)) {
      throw new IllegalArgumentException(
          "auth.password-reset.request-window must be exactly PT1H");
    }
    if (maxRequests != MAX_REQUESTS) {
      throw new IllegalArgumentException(
          "auth.password-reset.max-requests must be exactly 3");
    }
    frontendResetUri = validateFrontendResetUri(frontendResetUri).toASCIIString();
  }

  public byte[] hmacKeyBytes() {
    return hmacSecret.getBytes(StandardCharsets.UTF_8);
  }

  public long ttlMillis() {
    return ttl.toMillis();
  }

  public long claimTtlMillis() {
    return claimTtl.toMillis();
  }

  public long requestWindowMillis() {
    return requestWindow.toMillis();
  }

  public String resetLink(String rawToken) {
    if (rawToken == null || !rawToken.matches("pr1_[A-Za-z0-9_-]{43}")) {
      throw new IllegalArgumentException("raw password-reset token has an invalid shape");
    }
    String encoded = URLEncoder.encode(rawToken, StandardCharsets.UTF_8);
    return URI.create(frontendResetUri + "#token=" + encoded).toASCIIString();
  }

  @Override
  public String toString() {
    return "PasswordResetProperties[hmacSecret=<redacted>, ttl=" + ttl
        + ", claimTtl=" + claimTtl
        + ", requestWindow=" + requestWindow
        + ", maxRequests=" + maxRequests
        + ", frontendResetUri=" + frontendResetUri + "]";
  }

  private static Duration requireClaimTtl(Duration value) {
    if (value == null
        || value.isNegative()
        || value.isZero()
        || value.compareTo(Duration.ofSeconds(15)) < 0
        || value.compareTo(Duration.ofMinutes(2)) > 0) {
      throw new IllegalArgumentException(
          "auth.password-reset.claim-ttl must be between PT15S and PT2M");
    }
    try {
      if (value.toMillis() < 1) {
        throw new IllegalArgumentException(
            "auth.password-reset.claim-ttl must be representable in milliseconds");
      }
    } catch (ArithmeticException exception) {
      throw new IllegalArgumentException(
          "auth.password-reset.claim-ttl is too large", exception);
    }
    return value;
  }

  private static URI validateFrontendResetUri(String value) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(
          "auth.password-reset.frontend-reset-uri is required");
    }
    try {
      URI uri = URI.create(value.trim());
      String scheme = uri.getScheme();
      if (!uri.isAbsolute()
          || uri.getHost() == null
          || uri.getRawUserInfo() != null
          || uri.getRawQuery() != null
          || uri.getRawFragment() != null
          || (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme))) {
        throw new IllegalArgumentException(
            "auth.password-reset.frontend-reset-uri must be an absolute HTTP(S) URI "
                + "without query, fragment or user info");
      }
      if ("http".equalsIgnoreCase(scheme) && !isLoopback(uri.getHost())) {
        throw new IllegalArgumentException(
            "auth.password-reset.frontend-reset-uri must use HTTPS outside localhost");
      }
      return uri;
    } catch (IllegalArgumentException exception) {
      if (exception.getMessage() != null
          && exception.getMessage().startsWith("auth.password-reset.frontend-reset-uri")) {
        throw exception;
      }
      throw new IllegalArgumentException(
          "auth.password-reset.frontend-reset-uri is not a valid URI", exception);
    }
  }

  private static boolean isLoopback(String host) {
    return "localhost".equalsIgnoreCase(host)
        || "127.0.0.1".equals(host)
        || "::1".equals(host)
        || "[::1]".equals(host);
  }
}
