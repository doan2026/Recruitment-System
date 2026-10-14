package com.recruitment.auth.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OAuthAccountTest {
  @Test
  void googleIdentityUsesSubjectAndVerifiedNormalizedEmail() {
    UUID userId = UUID.randomUUID();

    OAuthAccount account = OAuthAccount.linkGoogle(
        userId, "google-subject-123", " Candidate@Example.COM ", true);

    assertThat(account.getUserId()).isEqualTo(userId);
    assertThat(account.getProvider()).isEqualTo(OAuthProvider.GOOGLE);
    assertThat(account.getProviderSubject()).isEqualTo("google-subject-123");
    assertThat(account.getProviderEmail()).isEqualTo("candidate@example.com");
    assertThat(account.isProviderEmailVerified()).isTrue();
  }

  @Test
  void rejectsUnverifiedGoogleEmailClaim() {
    assertThatThrownBy(() -> OAuthAccount.linkGoogle(
        UUID.randomUUID(), "google-subject-123", "candidate@example.com", false))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("verified");
  }
}
