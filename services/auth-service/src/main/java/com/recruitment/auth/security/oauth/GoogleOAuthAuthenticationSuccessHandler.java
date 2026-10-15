package com.recruitment.auth.security.oauth;

import com.recruitment.auth.config.properties.GoogleOAuthProperties;
import com.recruitment.auth.dto.oauth.GoogleOAuthRole;
import com.recruitment.auth.model.oauth.GoogleOAuthIdentity;
import com.recruitment.auth.repository.redis.oauth.GoogleOAuthExchangeStore;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Objects;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.StandardClaimNames;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

@Component
public final class GoogleOAuthAuthenticationSuccessHandler
    implements AuthenticationSuccessHandler {

  public static final String EXCHANGE_COOKIE_NAME = "oauth2_exchange_binder";
  public static final String EXCHANGE_COOKIE_PATH = "/auth/google/exchange";

  private final GoogleOAuthExchangeStore exchanges;
  private final GoogleOAuthProperties properties;

  public GoogleOAuthAuthenticationSuccessHandler(
      GoogleOAuthExchangeStore exchanges,
      GoogleOAuthProperties properties) {
    this.exchanges = Objects.requireNonNull(exchanges, "exchanges are required");
    this.properties = Objects.requireNonNull(properties, "properties are required");
  }

  @Override
  public void onAuthenticationSuccess(
      HttpServletRequest request,
      HttpServletResponse response,
      Authentication authentication) throws IOException, ServletException {
    try {
      if (!(authentication instanceof OAuth2AuthenticationToken oauth)
          || !"google".equals(oauth.getAuthorizedClientRegistrationId())
          || !(oauth.getPrincipal() instanceof OidcUser oidcUser)) {
        redirectFailure(response);
        return;
      }
      OidcIdToken idToken = oidcUser.getIdToken();
      if (idToken == null || !Boolean.TRUE.equals(
          idToken.getClaimAsBoolean(StandardClaimNames.EMAIL_VERIFIED))) {
        redirectFailure(response);
        return;
      }
      GoogleOAuthIdentity identity = new GoogleOAuthIdentity(
          idToken.getSubject(), idToken.getClaimAsString(StandardClaimNames.EMAIL));
      String storedRole = (String) request.getAttribute(GooglePkceAuthorizationRequestResolver.PORTAL_ROLE_ATTRIBUTE);
      GoogleOAuthRole role = storedRole == null ? GoogleOAuthRole.CANDIDATE : GoogleOAuthRole.valueOf(storedRole);
      GoogleOAuthExchangeStore.PendingExchange pending =
          exchanges.create(identity.subject(), identity.normalizedEmail(), role);
      response.addHeader(HttpHeaders.SET_COOKIE, exchangeCookie(pending).toString());
      setNoStore(response);
      response.setStatus(HttpStatus.FOUND.value());
      response.setHeader(
          HttpHeaders.LOCATION,
          properties.validatedFrontendRedirectUri() + "#code=" + pending.code() + "&role=" + role.name());
    } catch (RuntimeException invalidOrUnavailable) {
      redirectFailure(response);
    }
  }

  private ResponseCookie exchangeCookie(GoogleOAuthExchangeStore.PendingExchange pending) {
    return ResponseCookie.from(EXCHANGE_COOKIE_NAME, pending.binder())
        .httpOnly(true)
        .secure(properties.secureCookies())
        .sameSite("Lax")
        .path(EXCHANGE_COOKIE_PATH)
        .maxAge(pending.ttl())
        .build();
  }

  private void redirectFailure(HttpServletResponse response) {
    URI frontend = properties.validatedFrontendRedirectUri();
    setNoStore(response);
    response.setStatus(HttpStatus.FOUND.value());
    response.setHeader(
        HttpHeaders.LOCATION,
        frontend + "#error=GOOGLE_AUTHENTICATION_FAILED");
  }

  public static void setNoStore(HttpServletResponse response) {
    response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue());
    response.setHeader(HttpHeaders.PRAGMA, "no-cache");
  }
}
