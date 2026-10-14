package com.recruitment.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import com.recruitment.auth.config.properties.GoogleOAuthProperties;
import com.recruitment.auth.dto.oauth.GoogleOAuthExchangeRequest;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.security.oauth.GoogleOAuthSecurityConfigurer;
import com.recruitment.auth.service.oauth.GoogleOAuthExchangeService;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletResponse;

class GoogleOAuthControllerTest {
  private static final String CODE = "A".repeat(43);
  private static final String BINDER = "B".repeat(43);

  @Test
  void startUsesOnlyFixedInternalAuthorizationEndpoint() {
    GoogleOAuthController controller =
        new GoogleOAuthController(properties(true), mock(GoogleOAuthExchangeService.class));

    ResponseEntity<Void> response = controller.start();

    assertThat(response.getStatusCode().value()).isEqualTo(302);
    assertThat(response.getHeaders().getLocation()).hasToString(
        GoogleOAuthSecurityConfigurer.GOOGLE_AUTHORIZATION_URI);
    assertThat(response.getHeaders().getCacheControl()).contains("no-store");
  }

  @Test
  void exchangeClearsBinderCookieAndNeverCachesLocalTokens() {
    GoogleOAuthExchangeService service = mock(GoogleOAuthExchangeService.class);
    GoogleOAuthExchangeRequest request = new GoogleOAuthExchangeRequest(CODE, null);
    when(service.exchange(request, BINDER)).thenReturn(tokens());
    GoogleOAuthController controller = new GoogleOAuthController(properties(true), service);
    MockHttpServletResponse servletResponse = new MockHttpServletResponse();

    var response = controller.exchange(request, BINDER, servletResponse);

    assertThat(response.getStatusCode().value()).isEqualTo(200);
    assertThat(response.getHeaders().getCacheControl()).contains("no-store");
    assertThat(servletResponse.getHeader(HttpHeaders.SET_COOKIE))
        .contains(
            "oauth2_exchange_binder=",
            "Path=/auth/google/exchange",
            "Max-Age=0",
            "Secure",
            "HttpOnly",
            "SameSite=Lax")
        .doesNotContain(BINDER);
  }

  @Test
  void disabledProviderDoesNotExposeAnAuthorizationRedirect() {
    GoogleOAuthController controller =
        new GoogleOAuthController(properties(false), mock(GoogleOAuthExchangeService.class));

    assertThatThrownBy(controller::start)
        .isInstanceOfSatisfying(AuthBusinessException.class,
            error -> assertThat(error.code()).isEqualTo("GOOGLE_OAUTH_DISABLED"));
  }

  private static GoogleOAuthProperties properties(boolean enabled) {
    return new GoogleOAuthProperties(
        enabled,
        "client-id",
        "client-secret",
        "https://auth.example.com/auth/google/callback",
        "https://app.example.com/oauth/callback",
        true,
        Duration.ofMinutes(10),
        Duration.ofMinutes(2));
  }

  private static AuthTokenResponse tokens() {
    UUID id = UUID.fromString("11111111-2222-4333-8444-555555555555");
    return new AuthTokenResponse(
        "local-access-token",
        "Bearer",
        900,
        "local-refresh-token",
        604800,
        new AuthTokenResponse.UserInfo(
            id, "candidate@example.com", UserRole.CANDIDATE));
  }
}
