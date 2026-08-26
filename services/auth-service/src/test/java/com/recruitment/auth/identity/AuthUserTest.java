package com.recruitment.auth.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AuthUserTest {
  private static final String BCRYPT_HASH = "$2a$10$" + "a".repeat(53);

  @Test
  void localRegistrationNormalizesEmailAndStartsUnverified() {
    AuthUser user = AuthUser.registerLocal(
        "  Candidate@Example.COM ", BCRYPT_HASH, UserRole.CANDIDATE);

    assertThat(user.getId()).isNotNull();
    assertThat(user.getEmail()).isEqualTo("candidate@example.com");
    assertThat(user.getNormalizedEmail()).isEqualTo("candidate@example.com");
    assertThat(user.getPasswordHash()).isEqualTo(BCRYPT_HASH);
    assertThat(user.isVerified()).isFalse();
    assertThat(user.getVerifiedAt()).isNull();
  }

  @Test
  void emailNormalizationUsesUnicodeNfcAndLocaleIndependentLowercase() {
    assertThat(IdentityNormalizer.normalizeEmail("TE\u0301ST@EXAMPLE.COM"))
        .isEqualTo("tést@example.com");
  }

  @Test
  void verificationAndLockTransitionsKeepAuditStateTogether() {
    AuthUser user = AuthUser.registerLocal(
        "candidate@example.com", BCRYPT_HASH, UserRole.CANDIDATE);
    Instant verifiedAt = Instant.parse("2026-08-26T10:00:00Z");
    Instant lockedAt = verifiedAt.plusSeconds(60);

    user.verify(verifiedAt);
    user.lock("Policy violation", lockedAt);

    assertThat(user.isVerified()).isTrue();
    assertThat(user.getVerifiedAt()).isEqualTo(verifiedAt);
    assertThat(user.isLocked()).isTrue();
    assertThat(user.getLockedAt()).isEqualTo(lockedAt);
    assertThat(user.getLockedReason()).isEqualTo("Policy violation");

    user.unlock();

    assertThat(user.isLocked()).isFalse();
    assertThat(user.getLockedAt()).isNull();
    assertThat(user.getLockedReason()).isNull();
  }

  @Test
  void rejectsInvalidEmailAndShortPasswordHash() {
    assertThatThrownBy(() -> AuthUser.registerLocal(
        "not-an-email", BCRYPT_HASH, UserRole.CANDIDATE))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> AuthUser.registerLocal(
        "candidate@example.com", "plaintext", UserRole.CANDIDATE))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> AuthUser.registerLocal(
        "candidate@example.com", "a".repeat(60), UserRole.CANDIDATE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("bcrypt cost-10");
    assertThatThrownBy(() -> AuthUser.registerLocal(
        "candidate@example.com", "$2a$12$" + "a".repeat(53), UserRole.CANDIDATE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("bcrypt cost-10");
  }

  @Test
  void selfRegistrationRejectsAdminAndOAuthDefaultsToCandidate() {
    Instant verifiedAt = Instant.parse("2026-08-26T10:00:00Z");

    assertThatThrownBy(() -> AuthUser.registerLocal(
        "admin@example.com", BCRYPT_HASH, UserRole.ADMIN))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("ADMIN");

    AuthUser oauthUser = AuthUser.registerOAuth("candidate@example.com", verifiedAt);

    assertThat(oauthUser.getRole()).isEqualTo(UserRole.CANDIDATE);
    assertThat(oauthUser.isVerified()).isTrue();
    assertThat(oauthUser.getVerifiedAt()).isEqualTo(verifiedAt);
  }

  @Test
  void failedVerificationAndLockLeaveAuditStateUnchanged() {
    AuthUser user = AuthUser.registerLocal(
        "candidate@example.com", BCRYPT_HASH, UserRole.CANDIDATE);

    assertThatThrownBy(() -> user.verify(null))
        .isInstanceOf(NullPointerException.class)
        .hasMessageContaining("verification time");
    assertThat(user.isVerified()).isFalse();
    assertThat(user.getVerifiedAt()).isNull();

    assertThatThrownBy(() -> user.lock("Policy violation", null))
        .isInstanceOf(NullPointerException.class)
        .hasMessageContaining("lock time");
    assertThat(user.isLocked()).isFalse();
    assertThat(user.getLockedAt()).isNull();
    assertThat(user.getLockedReason()).isNull();
  }

  @Test
  void rejectsPartialUnlockedAuditState() {
    AuthUser user = AuthUser.registerLocal(
        "candidate@example.com", BCRYPT_HASH, UserRole.CANDIDATE);
    ReflectionTestUtils.setField(user, "lockedAt", Instant.parse("2026-08-26T10:00:00Z"));

    assertThatThrownBy(user::validateState)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("must change together");
  }
}
