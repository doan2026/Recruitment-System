package com.recruitment.interview.config;

import java.net.URI;
import java.util.Arrays;
import java.util.List;

record InterviewJwtProperties(
    String publicKeyPath,
    String issuer,
    String audience
) {
  InterviewJwtProperties {
    publicKeyPath = requireText(publicKeyPath, "JWT_PUBLIC_KEY_PATH");
    issuer = requireText(issuer, "JWT_ISSUER");
    audience = requireText(audience, "JWT_AUDIENCE");
  }

  private static String requireText(String value, String name) {
    if (value == null || value.isBlank() || !value.equals(value.trim())) {
      throw new IllegalArgumentException(name + " must be a non-blank, trimmed value");
    }
    if (value.chars().anyMatch(Character::isISOControl)) {
      throw new IllegalArgumentException(name + " must not contain control characters");
    }
    return value;
  }
}

record InterviewCorsProperties(List<String> allowedOrigins) {
  InterviewCorsProperties {
    if (allowedOrigins == null) {
      allowedOrigins = List.of();
    }
    allowedOrigins = allowedOrigins.stream()
        .map(InterviewCorsProperties::requireValidOrigin)
        .distinct()
        .toList();
    if (allowedOrigins.isEmpty()) {
      throw new IllegalArgumentException("CORS_ORIGINS cannot be empty");
    }
  }

  static InterviewCorsProperties parse(String configuredOrigins) {
    if (configuredOrigins == null) {
      return new InterviewCorsProperties(List.of());
    }
    return new InterviewCorsProperties(Arrays.asList(configuredOrigins.split(",", -1)));
  }

  private static String requireValidOrigin(String configuredOrigin) {
    String origin = configuredOrigin == null ? "" : configuredOrigin.trim();
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
          && exception.getMessage().startsWith("CORS_ORIGINS")) {
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
        "CORS_ORIGINS must contain exact HTTPS origins; HTTP is loopback-only");
  }
}
