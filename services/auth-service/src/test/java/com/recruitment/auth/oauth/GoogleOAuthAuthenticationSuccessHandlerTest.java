package com.recruitment.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.StandardClaimNames;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

class GoogleOAuthAuthenticationSuccessHandlerTest {
  private static final String CODE = "A".repeat(43);
  private static final String BINDER = "B".repeat(43);

  @Test
  void redirectsWithOneTimeCodeInFragmentAndHttpOnlyBinderCookie() throws Exception {
    GoogleOAuthExchangeStore store = mock(GoogleOAuthExchangeStore.class);
    when(store.create("google-subject", "candidate@example.com")).thenReturn(
        new GoogleOAuthExchangeStore.PendingExchange(
            CODE, BINDER, Duration.ofMinutes(2)));
    GoogleOAuthAuthenticationSuccessHandler handler =
        new GoogleOAuthAuthenticationSuccessHandler(store, properties());
    MockHttpServletResponse response = new MockHttpServletResponse();

    handler.onAuthenticationSuccess(
        new MockHttpServletRequest(), response, authentication(true));

    assertThat(response.getStatus()).isEqualTo(302);
    assertThat(response.getHeader(HttpHeaders.LOCATION))
        .isEqualTo("https://app.example.com/oauth/callback?source=google#code=" + CODE)
        .doesNotContain("access_token", "refresh_token", BINDER);
    assertThat(response.getHeader(HttpHeaders.SET_COOKIE))
        .contains(
            "oauth2_exchange_binder=" + BINDER,
            "Path=/auth/google/exchange",
            "Max-Age=120",
            "Secure",
            "HttpOnly",
            "SameSite=Lax");
    assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL)).contains("no-store");
  }

  @Test
  void rejectsUnverifiedEmailBeforeCreatingExchangeState() throws Exception {
    GoogleOAuthExchangeStore store = mock(GoogleOAuthExchangeStore.class);
    GoogleOAuthAuthenticationSuccessHandler handler =
        new GoogleOAuthAuthenticationSuccessHandler(store, properties());
    MockHttpServletResponse response = new MockHttpServletResponse();

    handler.onAuthenticationSuccess(
        new MockHttpServletRequest(), response, authentication(false));

    assertThat(response.getStatus()).isEqualTo(302);
    assertThat(response.getHeader(HttpHeaders.LOCATION))
        .endsWith("#error=GOOGLE_AUTHENTICATION_FAILED");
    verifyNoInteractions(store);
  }

  private static OAuth2AuthenticationToken authentication(boolean emailVerified) {
    Instant now = Instant.parse("2026-08-26T10:00:00Z");
    OidcIdToken idToken = new OidcIdToken(
        "signed-provider-id-token",
        now,
        now.plusSeconds(300),
        Map.of(
            StandardClaimNames.SUB, "google-subject",
            StandardClaimNames.EMAIL, "Candidate@Example.COM",
            StandardClaimNames.EMAIL_VERIFIED, emailVerified));
    OidcUser principal = mock(OidcUser.class);
    when(principal.getIdToken()).thenReturn(idToken);
    return new OAuth2AuthenticationToken(principal, List.of(), "google");
  }

  private static GoogleOAuthProperties properties() {
    return new GoogleOAuthProperties(
        true,
        "client-id",
        "client-secret",
        "https://auth.example.com/auth/google/callback",
        "https://app.example.com/oauth/callback?source=google",
        true,
        Duration.ofMinutes(10),
        Duration.ofMinutes(2));
  }
}
