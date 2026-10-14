package com.recruitment.auth.controller;

import com.recruitment.auth.config.properties.GoogleOAuthProperties;
import com.recruitment.auth.dto.common.ApiResponse;
import com.recruitment.auth.dto.oauth.GoogleOAuthExchangeRequest;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.security.oauth.GoogleOAuthAuthenticationSuccessHandler;
import com.recruitment.auth.security.oauth.GoogleOAuthSecurityConfigurer;
import com.recruitment.auth.service.oauth.GoogleOAuthExchangeService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.Duration;
import java.util.Objects;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth/google")
public class GoogleOAuthController {
  private final GoogleOAuthProperties properties;
  private final GoogleOAuthExchangeService exchange;

  public GoogleOAuthController(
      GoogleOAuthProperties properties,
      GoogleOAuthExchangeService exchange) {
    this.properties = Objects.requireNonNull(properties, "properties are required");
    this.exchange = Objects.requireNonNull(exchange, "exchange is required");
  }

  @GetMapping
  public ResponseEntity<Void> start() {
    requireEnabled();
    return ResponseEntity.status(HttpStatus.FOUND)
        .location(URI.create(GoogleOAuthSecurityConfigurer.GOOGLE_AUTHORIZATION_URI))
        .cacheControl(CacheControl.noStore())
        .header(HttpHeaders.PRAGMA, "no-cache")
        .build();
  }

  @PostMapping("/exchange")
  public ResponseEntity<ApiResponse<AuthTokenResponse>> exchange(
      @Valid @RequestBody GoogleOAuthExchangeRequest request,
      @CookieValue(
          name = GoogleOAuthAuthenticationSuccessHandler.EXCHANGE_COOKIE_NAME,
          required = false)
      String binder,
      HttpServletResponse servletResponse) {
    requireEnabled();
    servletResponse.addHeader(
        HttpHeaders.SET_COOKIE, expiredExchangeCookie().toString());
    GoogleOAuthAuthenticationSuccessHandler.setNoStore(servletResponse);
    AuthTokenResponse tokens = exchange.exchange(request, binder);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header(HttpHeaders.PRAGMA, "no-cache")
        .body(ApiResponse.of(tokens));
  }

  private void requireEnabled() {
    if (!properties.enabled()) {
      throw new AuthBusinessException(
          "GOOGLE_OAUTH_DISABLED",
          "Google sign-in is not enabled",
          HttpStatus.NOT_FOUND);
    }
  }

  private ResponseCookie expiredExchangeCookie() {
    return ResponseCookie.from(
            GoogleOAuthAuthenticationSuccessHandler.EXCHANGE_COOKIE_NAME, "")
        .httpOnly(true)
        .secure(properties.secureCookies())
        .sameSite("Lax")
        .path(GoogleOAuthAuthenticationSuccessHandler.EXCHANGE_COOKIE_PATH)
        .maxAge(Duration.ZERO)
        .build();
  }
}
