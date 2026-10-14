package com.recruitment.auth.repository.redis.otp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ChallengeInspection;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ChallengeState;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class RedisOtpChallengeStoreTest {
  private static final String STORED_CHALLENGE =
      "v1." + "A".repeat(22) + "." + "B".repeat(43);

  @Test
  void inspectionSurfacesRemainingBlockAfterChallengeWasDeleted() {
    ChallengeInspection inspection =
        RedisOtpChallengeStore.parseChallengeInspection("BLOCKED|5|899999|");

    assertThat(inspection.state()).isEqualTo(ChallengeState.BLOCKED);
    assertThat(inspection.failedAttempts()).isEqualTo(5);
    assertThat(inspection.retryAfter()).isEqualTo(Duration.ofMillis(899999));
    assertThat(inspection.storedChallenge()).isNull();
  }

  @Test
  void missingInspectionPreservesAttemptsWithoutExposingAChallenge() {
    ChallengeInspection inspection =
        RedisOtpChallengeStore.parseChallengeInspection("MISSING|4|0|");

    assertThat(inspection.state()).isEqualTo(ChallengeState.MISSING);
    assertThat(inspection.failedAttempts()).isEqualTo(4);
    assertThat(inspection.retryAfter()).isZero();
    assertThat(inspection.storedChallenge()).isNull();
  }

  @Test
  void readyInspectionCarriesOpaqueSnapshotWithoutLoggingIt() {
    ChallengeInspection inspection = RedisOtpChallengeStore.parseChallengeInspection(
        "READY|2|250000|" + STORED_CHALLENGE);

    assertThat(inspection.state()).isEqualTo(ChallengeState.READY);
    assertThat(inspection.failedAttempts()).isEqualTo(2);
    assertThat(inspection.retryAfter()).isEqualTo(Duration.ofMillis(250000));
    assertThat(inspection.storedChallenge()).isEqualTo(STORED_CHALLENGE);
    assertThat(inspection.toString())
        .contains("storedChallenge=<redacted>")
        .doesNotContain(STORED_CHALLENGE);
  }

  @Test
  void corruptOrIncoherentInspectionFailsClosed() {
    assertThatThrownBy(
            () -> RedisOtpChallengeStore.parseChallengeInspection("CORRUPT|0|0|"))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () -> RedisOtpChallengeStore.parseChallengeInspection("READY|0|1000|invalid"))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () -> RedisOtpChallengeStore.parseChallengeInspection(
                "BLOCKED|5|1000|" + STORED_CHALLENGE))
        .isInstanceOf(IllegalStateException.class);
  }
}
