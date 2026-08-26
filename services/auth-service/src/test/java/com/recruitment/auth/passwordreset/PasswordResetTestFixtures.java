package com.recruitment.auth.passwordreset;

import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.UserRole;
import java.time.Duration;
import java.time.Instant;

final class PasswordResetTestFixtures {
  static final String SECRET = "password-reset-hmac-secret-at-least-32-bytes";
  static final String EMAIL = "candidate@example.com";
  static final String CURRENT_HASH = "$2a$10$" + "a".repeat(53);
  static final String NEXT_HASH = "$2a$10$" + "b".repeat(53);
  static final Instant NOW = Instant.parse("2026-08-26T12:00:00Z");

  private PasswordResetTestFixtures() {}

  static PasswordResetProperties properties() {
    return properties(SECRET, "https://app.recruitment.test/reset-password");
  }

  static PasswordResetProperties properties(String secret, String frontendUri) {
    return new PasswordResetProperties(
        secret,
        Duration.ofMinutes(15),
        Duration.ofSeconds(30),
        Duration.ofHours(1),
        3,
        frontendUri);
  }

  static AuthUser verifiedLocal() {
    AuthUser user = AuthUser.registerLocal(
        EMAIL, CURRENT_HASH, UserRole.CANDIDATE);
    user.verify(NOW.minusSeconds(60));
    return user;
  }
}
