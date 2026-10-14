package com.recruitment.auth.security.token;

import static org.assertj.core.api.Assertions.assertThat;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.dto.token.RefreshTokenRequest;
import com.recruitment.auth.model.UserRole;
import java.security.SecureRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RefreshTokenCodecTest {
  @Test
  void issuesAtLeast256BitsAndStoresOnlyDeterministicSha256Hash() {
    RefreshTokenCodec codec = new RefreshTokenCodec(new SecureRandom());

    RefreshTokenCodec.Material first = codec.issue();
    RefreshTokenCodec.Material second = codec.issue();

    assertThat(first.rawToken()).matches("^rt1_[A-Za-z0-9_-]{43}$");
    assertThat(first.rawToken()).isNotEqualTo(second.rawToken());
    assertThat(first.tokenHash()).matches("^[0-9a-f]{64}$");
    assertThat(codec.hashPresented(first.rawToken())).contains(first.tokenHash());
    assertThat(first.toString())
        .doesNotContain(first.rawToken())
        .doesNotContain(first.tokenHash())
        .contains("<redacted>");
  }

  @Test
  void rejectsMalformedPresentedTokensBeforeHashLookup() {
    RefreshTokenCodec codec = new RefreshTokenCodec(new SecureRandom());

    assertThat(codec.hashPresented(null)).isEmpty();
    assertThat(codec.hashPresented("")).isEmpty();
    assertThat(codec.hashPresented("raw-refresh-token")).isEmpty();
    assertThat(codec.hashPresented("rt1_" + "a".repeat(42))).isEmpty();
    assertThat(codec.hashPresented("rt1_" + "a".repeat(44))).isEmpty();
  }

  @Test
  void tokenBearingApiTypesRedactTokensAndEmailFromToString() {
    UUID userId = UUID.randomUUID();
    String access = "header.payload.signature";
    String refresh = "rt1_" + "a".repeat(43);
    AuthTokenResponse response = new AuthTokenResponse(
        access,
        "Bearer",
        900,
        refresh,
        604800,
        new AuthTokenResponse.UserInfo(
            userId, "private@example.com", UserRole.CANDIDATE));

    assertThat(response.toString())
        .doesNotContain(access)
        .doesNotContain(refresh)
        .doesNotContain("private@example.com")
        .contains("accessToken=<redacted>")
        .contains("refreshToken=<redacted>")
        .contains("email=<redacted>");
    assertThat(new RefreshTokenRequest(refresh).toString())
        .doesNotContain(refresh)
        .contains("refreshToken=<redacted>");
  }
}
