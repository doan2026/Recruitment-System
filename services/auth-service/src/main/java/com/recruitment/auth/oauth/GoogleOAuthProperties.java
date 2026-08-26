package com.recruitment.auth.oauth;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth.google")
public record GoogleOAuthProperties(
    boolean enabled,
    String clientId,
    String clientSecret,
    String redirectUri,
    String frontendRedirectUri,
    boolean secureCookies,
    Duration authorizationRequestTtl,
    Duration exchangeTtl) {

  static final Duration DEFAULT_AUTHORIZATION_REQUEST_TTL = Duration.ofMinutes(10);
  static final Duration DEFAULT_EXCHANGE_TTL = Duration.ofMinutes(2);

  public GoogleOAuthProperties {
    authorizationRequestTtl = authorizationRequestTtl == null
        ? DEFAULT_AUTHORIZATION_REQUEST_TTL
        : requireReasonableTtl(
            authorizationRequestTtl,
            "auth.google.authorization-request-ttl",
            Duration.ofMinutes(1),
            Duration.ofMinutes(15));
    exchangeTtl = exchangeTtl == null
        ? DEFAULT_EXCHANGE_TTL
        : requireReasonableTtl(
            exchangeTtl,
            "auth.google.exchange-ttl",
            Duration.ofSeconds(30),
            Duration.ofMinutes(5));
  }

  public void validateEnabledConfiguration() {
    requireText(clientId, "auth.google.client-id");
    requireText(clientSecret, "auth.google.client-secret");
    URI callback = requireAbsoluteHttpUri(redirectUri, "auth.google.redirect-uri");
    if (!"/auth/google/callback".equals(callback.getPath())
        || callback.getRawQuery() != null
        || callback.getRawFragment() != null) {
      throw new IllegalArgumentException(
          "auth.google.redirect-uri must use the exact /auth/google/callback path");
    }
    URI frontend = requireAbsoluteHttpUri(
        frontendRedirectUri, "auth.google.frontend-redirect-uri");
    if (frontend.getRawFragment() != null) {
      throw new IllegalArgumentException(
          "auth.google.frontend-redirect-uri cannot contain a fragment");
    }
    if (!secureCookies && (!isLoopback(callback) || !isLoopback(frontend))) {
      throw new IllegalArgumentException(
          "auth.google.secure-cookies may be false only for loopback development URIs");
    }
  }

  URI validatedFrontendRedirectUri() {
    validateEnabledConfiguration();
    URI value = requireAbsoluteHttpUri(
        frontendRedirectUri, "auth.google.frontend-redirect-uri");
    if (value.getRawFragment() != null) {
      throw new IllegalArgumentException(
          "auth.google.frontend-redirect-uri cannot contain a fragment");
    }
    return value;
  }

  long authorizationRequestTtlMillis() {
    return authorizationRequestTtl.toMillis();
  }

  long exchangeTtlMillis() {
    return exchangeTtl.toMillis();
  }

  @Override
  public String toString() {
    return "GoogleOAuthProperties[enabled=" + enabled
        + ", clientId=<redacted>, clientSecret=<redacted>, redirectUri=" + redirectUri
        + ", frontendRedirectUri=" + frontendRedirectUri
        + ", secureCookies=" + secureCookies
        + ", authorizationRequestTtl=" + authorizationRequestTtl
        + ", exchangeTtl=" + exchangeTtl + "]";
  }

  private static Duration requireReasonableTtl(
      Duration value,
      String property,
      Duration minimum,
      Duration maximum) {
    if (value.isNegative() || value.isZero()
        || value.compareTo(minimum) < 0
        || value.compareTo(maximum) > 0) {
      throw new IllegalArgumentException(
          property + " must be between " + minimum + " and " + maximum);
    }
    return value;
  }

  private static String requireText(String value, String property) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(property + " is required when Google OAuth is enabled");
    }
    return value.trim();
  }

  private static URI requireAbsoluteHttpUri(String value, String property) {
    String text = requireText(value, property);
    try {
      URI uri = URI.create(text);
      if (!uri.isAbsolute()
          || uri.getHost() == null
          || uri.getRawUserInfo() != null
          || !("https".equalsIgnoreCase(uri.getScheme())
              || "http".equalsIgnoreCase(uri.getScheme()))) {
        throw new IllegalArgumentException(property + " must be an absolute HTTP(S) URI");
      }
      if ("http".equalsIgnoreCase(uri.getScheme())
          && !isLoopback(uri)) {
        throw new IllegalArgumentException(property + " must use HTTPS outside localhost");
      }
      return uri;
    } catch (IllegalArgumentException exception) {
      if (exception.getMessage() != null && exception.getMessage().startsWith(property)) {
        throw exception;
      }
      throw new IllegalArgumentException(property + " is not a valid URI", exception);
    }
  }

  private static boolean isLoopback(URI uri) {
    String host = uri.getHost();
    return "localhost".equalsIgnoreCase(host)
        || "127.0.0.1".equals(host)
        || "::1".equals(host)
        || "[::1]".equals(host);
  }
}
