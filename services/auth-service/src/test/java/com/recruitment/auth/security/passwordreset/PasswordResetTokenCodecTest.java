package com.recruitment.auth.security.passwordreset;

import com.recruitment.auth.support.PasswordResetTestFixtures;

import static org.assertj.core.api.Assertions.assertThat;
import java.security.SecureRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class PasswordResetTokenCodecTest {
  @Test
  void issuesIndependent256BitTokensAndStoresOnlyHmacDigest() {
    PasswordResetTokenCodec codec = new PasswordResetTokenCodec(
        PasswordResetTestFixtures.properties(), new SecureRandom());

    PasswordResetTokenCodec.Material first = codec.issue();
    PasswordResetTokenCodec.Material second = codec.issue();

    assertThat(first.rawToken()).matches("^pr1_[A-Za-z0-9_-]{43}$");
    assertThat(first.rawToken()).isNotEqualTo(second.rawToken());
    assertThat(first.tokenDigest()).matches("^[0-9a-f]{64}$");
    assertThat(codec.digestPresented(first.rawToken()))
        .contains(first.tokenDigest());
    assertThat(first.toString())
        .contains("rawToken=<redacted>", "tokenDigest=<redacted>")
        .doesNotContain(first.rawToken())
        .doesNotContain(first.tokenDigest());
  }

  @Test
  void rejectsMalformedOrTruncatedPresentedTokens() {
    PasswordResetTokenCodec codec = new PasswordResetTokenCodec(
        PasswordResetTestFixtures.properties(), new SecureRandom());

    assertThat(codec.digestPresented(null)).isEmpty();
    assertThat(codec.digestPresented("")).isEmpty();
    assertThat(codec.digestPresented("pr1_" + "A".repeat(42))).isEmpty();
    assertThat(codec.digestPresented("rt1_" + "A".repeat(43))).isEmpty();
    assertThat(codec.digestPresented("pr1_" + "*".repeat(43))).isEmpty();
  }

  @Test
  void derivesCanonicalNonPiiEmailAndUserKeysWithSeparateDomains() {
    PasswordResetTokenCodec codec = new PasswordResetTokenCodec(
        PasswordResetTestFixtures.properties(), new SecureRandom());
    UUID firstUser = UUID.randomUUID();
    UUID secondUser = UUID.randomUUID();

    String canonicalEmail = codec.emailKey("candidate@example.com");
    String variantEmail = codec.emailKey(" Candidate@Example.COM ");
    String firstUserKey = codec.userKey(firstUser);

    assertThat(canonicalEmail)
        .isEqualTo(variantEmail)
        .matches("^[A-Za-z0-9_-]{43}$")
        .doesNotContain("candidate");
    assertThat(firstUserKey)
        .matches("^[A-Za-z0-9_-]{43}$")
        .doesNotContain(firstUser.toString())
        .isNotEqualTo(codec.userKey(secondUser))
        .isNotEqualTo(canonicalEmail);
  }

  @Test
  void distinctHmacSecretsProduceDistinctDigestsForSameEntropy() {
    byte[] entropy = new byte[32];
    SecureRandom fixedFirst = new FixedSecureRandom(entropy);
    SecureRandom fixedSecond = new FixedSecureRandom(entropy);
    PasswordResetTokenCodec first = new PasswordResetTokenCodec(
        PasswordResetTestFixtures.properties(), fixedFirst);
    PasswordResetTokenCodec second = new PasswordResetTokenCodec(
        PasswordResetTestFixtures.properties(
            "another-password-reset-secret-at-least-32-bytes",
            "https://app.recruitment.test/reset-password"),
        fixedSecond);

    assertThat(first.issue().tokenDigest())
        .isNotEqualTo(second.issue().tokenDigest());
  }

  private static final class FixedSecureRandom extends SecureRandom {
    private final byte[] value;

    private FixedSecureRandom(byte[] value) {
      this.value = value.clone();
    }

    @Override
    public void nextBytes(byte[] bytes) {
      System.arraycopy(value, 0, bytes, 0, bytes.length);
    }
  }
}
