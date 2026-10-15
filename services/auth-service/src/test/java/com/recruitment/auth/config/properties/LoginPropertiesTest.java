package com.recruitment.auth.config.properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class LoginPropertiesTest {
  private static final String SECRET = "login-hmac-secret-with-at-least-32-bytes";

  @Test
  void acceptsPositiveDurationsAndAttemptCountWithoutPrintingSecret() {
    LoginProperties properties = new LoginProperties(
        SECRET, Duration.ofMinutes(15), Duration.ofMinutes(15), 5);

    assertThat(properties.failureWindowMillis()).isEqualTo(900_000);
    assertThat(properties.failureBlockMillis()).isEqualTo(900_000);
    assertThat(properties.toString())
        .contains("hmacSecret=<redacted>")
        .doesNotContain(SECRET);
  }

  @Test
  void rejectsMissingShortOrBlankSecret() {
    assertThatThrownBy(() -> properties(null, Duration.ofMinutes(1), 5))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("at least 32");
    assertThatThrownBy(() -> properties(" ", Duration.ofMinutes(1), 5))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> properties("too-short", Duration.ofMinutes(1), 5))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsZeroSubMillisecondOrNegativeDurations() {
    assertThatThrownBy(() -> properties(SECRET, Duration.ZERO, 5))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("failure-block-duration");
    assertThatThrownBy(() -> new LoginProperties(
        SECRET, Duration.ofNanos(1), Duration.ofMinutes(1), 5))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("millisecond");
    assertThatThrownBy(() -> properties(SECRET, Duration.ofSeconds(-1), 5))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsNonPositiveAttemptCount() {
    assertThatThrownBy(() -> properties(SECRET, Duration.ofMinutes(1), 0))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("max-failed-attempts");
  }

  private LoginProperties properties(
      String secret, Duration blockDuration, int maximumAttempts) {
    return new LoginProperties(
        secret, Duration.ofMinutes(15), blockDuration, maximumAttempts);
  }
}
