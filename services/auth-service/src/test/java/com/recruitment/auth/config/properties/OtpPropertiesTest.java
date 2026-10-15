package com.recruitment.auth.config.properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class OtpPropertiesTest {
  private static final String SECRET = "0123456789abcdef0123456789abcdef";

  @Test
  void acceptsPositiveDurationsCountsAndA32ByteSecretWithoutExposingIt() {
    OtpProperties properties = properties(SECRET);

    assertThat(properties.hmacSecret()).isEqualTo(SECRET);
    assertThat(properties.ttl()).isEqualTo(Duration.ofMinutes(5));
    assertThat(properties.failureBlockDuration()).isEqualTo(Duration.ofMinutes(15));
    assertThat(properties.maxFailedAttempts()).isEqualTo(5);
    assertThat(properties.resendWindow()).isEqualTo(Duration.ofHours(1));
    assertThat(properties.maxResends()).isEqualTo(3);
    assertThat(properties.claimTtl()).isEqualTo(Duration.ofSeconds(30));
    assertThat(properties.dispatchLockTtl()).isEqualTo(Duration.ofSeconds(20));
    assertThat(properties.toString())
        .contains("hmacSecret=<redacted>")
        .doesNotContain(SECRET);
  }

  @Test
  void measuresSecretStrengthInUtf8Bytes() {
    String sixteenTwoByteCharacters = "é".repeat(16);

    assertThat(properties(sixteenTwoByteCharacters).hmacSecret())
        .isEqualTo(sixteenTwoByteCharacters);
    assertThatThrownBy(() -> properties("a".repeat(31)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("32 UTF-8 bytes");
    assertThatThrownBy(() -> properties(" ".repeat(32)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("32 UTF-8 bytes");
  }

  @Test
  void rejectsMissingNonPositiveOrSubMillisecondDurations() {
    assertThatThrownBy(() -> new OtpProperties(
        SECRET,
        Duration.ZERO,
        Duration.ofMinutes(15),
        5,
        Duration.ofHours(1),
        3,
        Duration.ofSeconds(30),
        Duration.ofSeconds(20)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("auth.otp.ttl");

    assertThatThrownBy(() -> new OtpProperties(
        SECRET,
        Duration.ofMinutes(5),
        Duration.ofNanos(1),
        5,
        Duration.ofHours(1),
        3,
        Duration.ofSeconds(30),
        Duration.ofSeconds(20)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("one millisecond");

    assertThatThrownBy(() -> new OtpProperties(
        SECRET,
        Duration.ofMinutes(5),
        Duration.ofMinutes(15),
        5,
        Duration.ofHours(1),
        3,
        null,
        Duration.ofSeconds(20)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("auth.otp.claim-ttl");
  }

  @Test
  void rejectsNonPositiveAttemptAndResendLimits() {
    assertThatThrownBy(() -> new OtpProperties(
        SECRET,
        Duration.ofMinutes(5),
        Duration.ofMinutes(15),
        0,
        Duration.ofHours(1),
        3,
        Duration.ofSeconds(30),
        Duration.ofSeconds(20)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("max-failed-attempts");

    assertThatThrownBy(() -> new OtpProperties(
        SECRET,
        Duration.ofMinutes(5),
        Duration.ofMinutes(15),
        5,
        Duration.ofHours(1),
        0,
        Duration.ofSeconds(30),
        Duration.ofSeconds(20)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("max-resends");
  }

  private static OtpProperties properties(String secret) {
    return new OtpProperties(
        secret,
        Duration.ofMinutes(5),
        Duration.ofMinutes(15),
        5,
        Duration.ofHours(1),
        3,
        Duration.ofSeconds(30),
        Duration.ofSeconds(20));
  }
}
