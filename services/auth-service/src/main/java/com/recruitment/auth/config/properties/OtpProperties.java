package com.recruitment.auth.config.properties;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth.otp")
public record OtpProperties(
    String hmacSecret,
    Duration ttl,
    Duration failureBlockDuration,
    int maxFailedAttempts,
    Duration resendWindow,
    int maxResends,
    Duration claimTtl,
    Duration dispatchLockTtl) {

  private static final int MINIMUM_HMAC_SECRET_BYTES = 32;

  public OtpProperties {
    if (hmacSecret == null
        || hmacSecret.isBlank()
        || hmacSecret.getBytes(StandardCharsets.UTF_8).length < MINIMUM_HMAC_SECRET_BYTES) {
      throw new IllegalArgumentException(
          "auth.otp.hmac-secret must contain at least 32 UTF-8 bytes");
    }
    ttl = requirePositiveMillis(ttl, "auth.otp.ttl");
    failureBlockDuration = requirePositiveMillis(
        failureBlockDuration, "auth.otp.failure-block-duration");
    resendWindow = requirePositiveMillis(resendWindow, "auth.otp.resend-window");
    claimTtl = requirePositiveMillis(claimTtl, "auth.otp.claim-ttl");
    dispatchLockTtl = requirePositiveMillis(
        dispatchLockTtl, "auth.otp.dispatch-lock-ttl");
    if (maxFailedAttempts < 1) {
      throw new IllegalArgumentException("auth.otp.max-failed-attempts must be positive");
    }
    if (maxResends < 1) {
      throw new IllegalArgumentException("auth.otp.max-resends must be positive");
    }
  }

  public byte[] hmacKeyBytes() {
    return hmacSecret.getBytes(StandardCharsets.UTF_8);
  }

  public long ttlMillis() {
    return ttl.toMillis();
  }

  public long failureBlockMillis() {
    return failureBlockDuration.toMillis();
  }

  public long resendWindowMillis() {
    return resendWindow.toMillis();
  }

  public long claimTtlMillis() {
    return claimTtl.toMillis();
  }

  public long dispatchLockTtlMillis() {
    return dispatchLockTtl.toMillis();
  }

  @Override
  public String toString() {
    return "OtpProperties[hmacSecret=<redacted>, ttl=" + ttl
        + ", failureBlockDuration=" + failureBlockDuration
        + ", maxFailedAttempts=" + maxFailedAttempts
        + ", resendWindow=" + resendWindow
        + ", maxResends=" + maxResends
        + ", claimTtl=" + claimTtl
        + ", dispatchLockTtl=" + dispatchLockTtl + "]";
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
