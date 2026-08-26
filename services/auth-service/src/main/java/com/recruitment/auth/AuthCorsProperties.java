package com.recruitment.auth;

import java.net.URI;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth.cors")
record AuthCorsProperties(List<String> allowedOrigins) {
  AuthCorsProperties {
    if (allowedOrigins == null) {
      allowedOrigins = List.of();
    }
    allowedOrigins = allowedOrigins.stream()
        .map(AuthCorsProperties::requireValidOrigin)
        .distinct()
        .toList();
    if (allowedOrigins.isEmpty()) {
      throw new IllegalArgumentException("auth.cors.allowed-origins cannot be empty");
    }
  }

  private static String requireValidOrigin(String value) {
    String origin = value == null ? "" : value.trim();
    try {
      URI uri = URI.create(origin);
      String scheme = uri.getScheme();
      String path = uri.getRawPath();
      boolean supportedScheme = "https".equalsIgnoreCase(scheme)
          || "http".equalsIgnoreCase(scheme);
      if (!supportedScheme
          || uri.getHost() == null
          || uri.getRawUserInfo() != null
          || (path != null && !path.isEmpty())
          || uri.getRawQuery() != null
          || uri.getRawFragment() != null
          || "*".equals(uri.getHost())) {
        throw invalidOrigin();
      }
      if ("http".equalsIgnoreCase(scheme) && !isLoopback(uri.getHost())) {
        throw invalidOrigin();
      }
      return origin;
    } catch (IllegalArgumentException exception) {
      if (exception.getMessage() != null
          && exception.getMessage().startsWith("auth.cors.allowed-origins")) {
        throw exception;
      }
      throw invalidOrigin();
    }
  }

  private static boolean isLoopback(String host) {
    return "localhost".equalsIgnoreCase(host)
        || "127.0.0.1".equals(host)
        || "::1".equals(host)
        || "[::1]".equals(host);
  }

  private static IllegalArgumentException invalidOrigin() {
    return new IllegalArgumentException(
        "auth.cors.allowed-origins must contain exact HTTPS origins; HTTP is loopback-only");
  }
}
