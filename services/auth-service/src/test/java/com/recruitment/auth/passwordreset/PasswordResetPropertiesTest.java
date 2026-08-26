package com.recruitment.auth.passwordreset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class PasswordResetPropertiesTest {
  private static final String RAW_TOKEN = "pr1_" + "A".repeat(43);

  @Test
  void acceptsExactSecurityContractAndUsesFragmentWithoutPrintingSecret() {
    PasswordResetProperties properties = PasswordResetTestFixtures.properties();

    assertThat(properties.ttl()).isEqualTo(Duration.ofMinutes(15));
    assertThat(properties.claimTtl()).isEqualTo(Duration.ofSeconds(30));
    assertThat(properties.requestWindow()).isEqualTo(Duration.ofHours(1));
    assertThat(properties.maxRequests()).isEqualTo(3);
    assertThat(properties.resetLink(RAW_TOKEN))
        .isEqualTo(
            "https://app.recruitment.test/reset-password#token=" + RAW_TOKEN)
        .doesNotContain("?token=");
    assertThat(properties.toString())
        .contains("hmacSecret=<redacted>")
        .doesNotContain(PasswordResetTestFixtures.SECRET);
  }

  @Test
  void permitsHttpOnlyForLoopbackDevelopmentUri() {
    PasswordResetProperties properties = PasswordResetTestFixtures.properties(
        PasswordResetTestFixtures.SECRET,
        "http://localhost:3000/reset-password");

    assertThat(properties.frontendResetUri())
        .isEqualTo("http://localhost:3000/reset-password");
  }

  @Test
  void rejectsWeakSecretAndAnyDurationOrQuotaDrift() {
    assertThatThrownBy(() -> properties(
        "too-short",
        Duration.ofMinutes(15),
        Duration.ofSeconds(30),
        Duration.ofHours(1),
        3))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("at least 32");
    assertThatThrownBy(() -> properties(
        PasswordResetTestFixtures.SECRET,
        Duration.ofMinutes(14),
        Duration.ofSeconds(30),
        Duration.ofHours(1),
        3))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("exactly PT15M");
    assertThatThrownBy(() -> properties(
        PasswordResetTestFixtures.SECRET,
        Duration.ofMinutes(15),
        Duration.ofSeconds(2),
        Duration.ofHours(1),
        3))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("claim-ttl");
    assertThatThrownBy(() -> properties(
        PasswordResetTestFixtures.SECRET,
        Duration.ofMinutes(15),
        Duration.ofSeconds(30),
        Duration.ofMinutes(30),
        3))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("request-window");
    assertThatThrownBy(() -> properties(
        PasswordResetTestFixtures.SECRET,
        Duration.ofMinutes(15),
        Duration.ofSeconds(30),
        Duration.ofHours(1),
        4))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("max-requests");
  }

  @Test
  void claimLeaseAcceptsFifteenSecondBoundaryAndRejectsAnythingShorter() {
    PasswordResetProperties boundary = properties(
        PasswordResetTestFixtures.SECRET,
        Duration.ofMinutes(15),
        Duration.ofSeconds(15),
        Duration.ofHours(1),
        3);

    assertThat(boundary.claimTtl()).isEqualTo(Duration.ofSeconds(15));
    assertThatThrownBy(() -> properties(
        PasswordResetTestFixtures.SECRET,
        Duration.ofMinutes(15),
        Duration.ofMillis(14_999),
        Duration.ofHours(1),
        3))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("between PT15S and PT2M");
  }

  @Test
  void rejectsUnsafeOrAmbiguousFrontendUri() {
    assertThatThrownBy(() -> PasswordResetTestFixtures.properties(
        PasswordResetTestFixtures.SECRET,
        "http://app.recruitment.test/reset-password"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("HTTPS");
    assertThatThrownBy(() -> PasswordResetTestFixtures.properties(
        PasswordResetTestFixtures.SECRET,
        "https://app.recruitment.test/reset-password?token=bad"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("without query");
    assertThatThrownBy(() -> PasswordResetTestFixtures.properties(
        PasswordResetTestFixtures.SECRET,
        "https://app.recruitment.test/reset-password#existing"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("without query");
  }

  private static PasswordResetProperties properties(
      String secret,
      Duration ttl,
      Duration claimTtl,
      Duration requestWindow,
      int maximumRequests) {
    return new PasswordResetProperties(
        secret,
        ttl,
        claimTtl,
        requestWindow,
        maximumRequests,
        "https://app.recruitment.test/reset-password");
  }
}
