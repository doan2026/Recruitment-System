package com.recruitment.auth.config.properties;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth.login")
public record LoginProperties(
    String hmacSecret,
    Duration failureWindow,
    Duration failureBlockDuration,
    int maxFailedAttempts) {

  private static final int MINIMUM_HMAC_SECRET_BYTES = 32;

  public LoginProperties {
    if (hmacSecret == null
        || hmacSecret.isBlank()
        || hmacSecret.getBytes(StandardCharsets.UTF_8).length < MINIMUM_HMAC_SECRET_BYTES) {
      throw new IllegalArgumentException(
          "auth.login.hmac-secret must contain at least 32 UTF-8 bytes");
    }
    failureWindow = requirePositiveMillis(failureWindow, "auth.login.failure-window");
    failureBlockDuration = requirePositiveMillis(
        failureBlockDuration, "auth.login.failure-block-duration");
    if (maxFailedAttempts < 1) {
      throw new IllegalArgumentException(
          "auth.login.max-failed-attempts must be positive");
    }
  }

  public byte[] hmacKeyBytes() {
    return hmacSecret.getBytes(StandardCharsets.UTF_8);
  }

  public long failureWindowMillis() {
    return failureWindow.toMillis();
  }

  public long failureBlockMillis() {
    return failureBlockDuration.toMillis();
  }

  @Override
  public String toString() {
    return "LoginProperties[hmacSecret=<redacted>, failureWindow=" + failureWindow
        + ", failureBlockDuration=" + failureBlockDuration
        + ", maxFailedAttempts=" + maxFailedAttempts + "]";
  }

  private static Duration requirePositiveMillis(Duration value, String property) {
    if (value == null || value.isNegative() || value.isZero()) {
      throw new IllegalArgumentException(property + " must be positive");
    }
    try {
      if (value.toMillis() < 1) {
        throw new IllegalArgumentException(
            property + " must be representable as at least one millisecond");
      }
    } catch (ArithmeticException exception) {
      throw new IllegalArgumentException(property + " is too large", exception);
    }
    return value;
  }
}
