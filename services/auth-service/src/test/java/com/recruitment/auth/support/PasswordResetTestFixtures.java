package com.recruitment.auth.support;

import com.recruitment.auth.config.properties.PasswordResetProperties;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.UserRole;
import java.time.Duration;
import java.time.Instant;

public final class PasswordResetTestFixtures {
  public static final String SECRET = "password-reset-hmac-secret-at-least-32-bytes";
  public static final String EMAIL = "candidate@example.com";
  public static final String CURRENT_HASH = "$2a$10$" + "a".repeat(53);
  public static final String NEXT_HASH = "$2a$10$" + "b".repeat(53);
  public static final Instant NOW = Instant.parse("2026-08-26T12:00:00Z");

  private PasswordResetTestFixtures() {}

  public static PasswordResetProperties properties() {
    return properties(SECRET, "https://app.recruitment.test/reset-password");
  }

  public static PasswordResetProperties properties(String secret, String frontendUri) {
    return new PasswordResetProperties(
        secret,
        Duration.ofMinutes(15),
        Duration.ofSeconds(30),
        Duration.ofHours(1),
        3,
        frontendUri);
  }

  public static AuthUser verifiedLocal() {
    AuthUser user = AuthUser.registerLocal(
        EMAIL, CURRENT_HASH, UserRole.CANDIDATE);
    user.verify(NOW.minusSeconds(60));
    return user;
  }
}
