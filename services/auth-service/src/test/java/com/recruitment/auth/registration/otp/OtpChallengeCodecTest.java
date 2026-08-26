package com.recruitment.auth.registration.otp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OtpChallengeCodecTest {
  private static final String SECRET = "0123456789abcdef0123456789abcdef";
  private static final UUID USER_ID = UUID.fromString(
      "10000000-0000-0000-0000-000000000001");
  private static final UUID REGISTRATION_ID = UUID.fromString(
      "20000000-0000-0000-0000-000000000001");
  private static final String EMAIL = "candidate@example.com";

  private OtpChallengeCodec codec;

  @BeforeEach
  void setUp() {
    SecureRandom random = mock(SecureRandom.class);
    AtomicInteger sequence = new AtomicInteger(1);
    doAnswer(invocation -> {
      byte[] destination = invocation.getArgument(0);
      Arrays.fill(destination, (byte) sequence.getAndIncrement());
      return null;
    }).when(random).nextBytes(any(byte[].class));
    codec = new OtpChallengeCodec(properties(SECRET), random);
  }

  @Test
  void encodesOnlyVersionGenerationAndDigestAndMatchesTheBoundInputs() {
    String stored = codec.encodeRegistration(
        USER_ID, REGISTRATION_ID, EMAIL, "012345");

    assertThat(stored).matches("v1\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}");
    assertThat(stored).doesNotContain(EMAIL).doesNotContain("012345");
    assertThat(codec.matchesRegistration(
        stored, USER_ID, REGISTRATION_ID, EMAIL, "012345")).isTrue();
    assertThat(codec.matchesRegistration(
        stored,
        USER_ID,
        REGISTRATION_ID,
        "  CANDIDATE@EXAMPLE.COM ",
        "012345")).isTrue();
  }

  @Test
  void bindsPurposeUserRegistrationFlowEmailGenerationAndCode() {
    String stored = codec.encodeRegistration(
        USER_ID, REGISTRATION_ID, EMAIL, "012345");
    UUID anotherUser = UUID.fromString("10000000-0000-0000-0000-000000000002");
    UUID anotherRegistration = UUID.fromString(
        "20000000-0000-0000-0000-000000000002");

    assertThat(codec.matchesRegistration(
        stored, anotherUser, REGISTRATION_ID, EMAIL, "012345")).isFalse();
    assertThat(codec.matchesRegistration(
        stored, USER_ID, anotherRegistration, EMAIL, "012345")).isFalse();
    assertThat(codec.matchesRegistration(
        stored, USER_ID, REGISTRATION_ID, "other@example.com", "012345")).isFalse();
    assertThat(codec.matchesRegistration(
        stored, USER_ID, REGISTRATION_ID, EMAIL, "012346")).isFalse();
    assertThat(codec.matches(
        stored,
        "password-reset",
        USER_ID,
        REGISTRATION_ID,
        EMAIL,
        "012345")).isFalse();

    String nextGeneration = codec.encodeRegistration(
        USER_ID, REGISTRATION_ID, EMAIL, "012345");
    assertThat(nextGeneration).isNotEqualTo(stored);
    assertThat(codec.matchesRegistration(
        nextGeneration, USER_ID, REGISTRATION_ID, EMAIL, "012345")).isTrue();
  }

  @Test
  void rejectsMalformedOrTamperedStoredChallengesWithoutThrowing() {
    String stored = codec.encodeRegistration(
        USER_ID, REGISTRATION_ID, EMAIL, "012345");
    String tampered = stored.substring(0, stored.indexOf('.', 3) + 1)
        + (stored.charAt(stored.indexOf('.', 3) + 1) == 'A' ? "B" : "A")
        + stored.substring(stored.indexOf('.', 3) + 2);

    assertThat(codec.matchesRegistration(
        null, USER_ID, REGISTRATION_ID, EMAIL, "012345")).isFalse();
    assertThat(codec.matchesRegistration(
        "v2.invalid.invalid", USER_ID, REGISTRATION_ID, EMAIL, "012345")).isFalse();
    assertThat(codec.matchesRegistration(
        "v1.====.====", USER_ID, REGISTRATION_ID, EMAIL, "012345")).isFalse();
    assertThat(codec.matchesRegistration(
        tampered, USER_ID, REGISTRATION_ID, EMAIL, "012345")).isFalse();
    assertThat(codec.matchesRegistration(
        stored, USER_ID, REGISTRATION_ID, EMAIL, "12A345")).isFalse();
  }

  @Test
  void derivesAStablePiiFreeClusterHashTagFromCanonicalEmail() {
    String emailKey = codec.emailKey(" Candidate@Example.COM ");

    assertThat(emailKey).matches("[A-Za-z0-9_-]{43}");
    assertThat(emailKey).doesNotContain("candidate").doesNotContain("example");
    assertThat(codec.emailKey(EMAIL)).isEqualTo(emailKey);

    OtpChallengeCodec otherSecretCodec = new OtpChallengeCodec(
        properties("abcdef0123456789abcdef0123456789"),
        mock(SecureRandom.class));
    assertThat(otherSecretCodec.emailKey(EMAIL)).isNotEqualTo(emailKey);
  }

  @Test
  void rejectsInvalidInputsBeforeEncoding() {
    assertThatThrownBy(() -> codec.encodeRegistration(
        null, REGISTRATION_ID, EMAIL, "012345"))
        .isInstanceOf(NullPointerException.class)
        .hasMessageContaining("userId");
    assertThatThrownBy(() -> codec.encodeRegistration(
        USER_ID, null, EMAIL, "012345"))
        .isInstanceOf(NullPointerException.class)
        .hasMessageContaining("registrationId");
    assertThatThrownBy(() -> codec.encodeRegistration(
        USER_ID, REGISTRATION_ID, "invalid", "012345"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("email");
    assertThatThrownBy(() -> codec.encodeRegistration(
        USER_ID, REGISTRATION_ID, EMAIL, "12345"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("six ASCII digits");
    assertThatThrownBy(() -> codec.encode(
        "Registration", USER_ID, REGISTRATION_ID, EMAIL, "012345"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("purpose");
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
