package com.recruitment.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class GoogleOAuthPropertiesTest {

  @Test
  void disabledConfigurationCanStartWithoutSecretsAndUsesShortDefaults() {
    GoogleOAuthProperties properties = new GoogleOAuthProperties(
        false, null, null, null, null, false, null, null);

    assertThat(properties.authorizationRequestTtl()).isEqualTo(Duration.ofMinutes(10));
    assertThat(properties.exchangeTtl()).isEqualTo(Duration.ofMinutes(2));
  }

  @Test
  void acceptsInsecureCookiesOnlyForLoopbackDevelopmentUris() {
    GoogleOAuthProperties local = properties(
        "http://localhost:8081/auth/google/callback",
        "http://127.0.0.1:3000/oauth/callback?source=google",
        false);

    local.validateEnabledConfiguration();

    assertThatThrownBy(() -> properties(
            "https://auth.example.com/auth/google/callback",
            "https://app.example.com/oauth/callback",
            false).validateEnabledConfiguration())
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("secure-cookies");
  }

  @Test
  void requiresExactCallbackAndFragmentFreeFixedFrontendRedirect() {
    assertThatThrownBy(() -> properties(
            "https://auth.example.com/login/oauth2/code/google",
            "https://app.example.com/oauth/callback",
            true).validateEnabledConfiguration())
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("exact /auth/google/callback");

    assertThatThrownBy(() -> properties(
            "https://auth.example.com/auth/google/callback",
            "https://app.example.com/oauth/callback#untrusted",
            true).validateEnabledConfiguration())
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("cannot contain a fragment");
  }

  @Test
  void redactsClientCredentialsFromDiagnostics() {
    GoogleOAuthProperties properties = properties(
        "https://auth.example.com/auth/google/callback",
        "https://app.example.com/oauth/callback",
        true);

    assertThat(properties.toString())
        .doesNotContain("google-client-id", "google-client-secret")
        .contains("clientId=<redacted>", "clientSecret=<redacted>");
  }

  private static GoogleOAuthProperties properties(
      String callback,
      String frontend,
      boolean secureCookies) {
    return new GoogleOAuthProperties(
        true,
        "google-client-id",
        "google-client-secret",
        callback,
        frontend,
        secureCookies,
        Duration.ofMinutes(10),
        Duration.ofMinutes(2));
  }
}
