package com.recruitment.auth.dto.token;

import com.recruitment.auth.model.UserRole;
import java.util.Objects;
import java.util.UUID;

public record AuthTokenResponse(
    String accessToken,
    String tokenType,
    long accessTokenExpiresInSeconds,
    String refreshToken,
    long refreshTokenExpiresInSeconds,
    UserInfo user) {

  public AuthTokenResponse {
    accessToken = requireToken(accessToken, "accessToken");
    if (!"Bearer".equals(tokenType)) {
      throw new IllegalArgumentException("tokenType must be Bearer");
    }
    if (accessTokenExpiresInSeconds <= 0 || refreshTokenExpiresInSeconds <= 0) {
      throw new IllegalArgumentException("token lifetimes must be positive");
    }
    refreshToken = requireToken(refreshToken, "refreshToken");
    Objects.requireNonNull(user, "user is required");
  }

  private static String requireToken(String value, String name) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(name + " is required");
    }
    return value;
  }

  @Override
  public String toString() {
    return "AuthTokenResponse[accessToken=<redacted>, tokenType=" + tokenType
        + ", accessTokenExpiresInSeconds=" + accessTokenExpiresInSeconds
        + ", refreshToken=<redacted>, refreshTokenExpiresInSeconds="
        + refreshTokenExpiresInSeconds + ", user=" + user + "]";
  }

  public record UserInfo(UUID id, String email, UserRole role) {
    public UserInfo {
      Objects.requireNonNull(id, "id is required");
      if (email == null || email.isBlank()) {
        throw new IllegalArgumentException("email is required");
      }
      Objects.requireNonNull(role, "role is required");
    }

    @Override
    public String toString() {
      return "UserInfo[id=" + id + ", email=<redacted>, role=" + role + "]";
    }
  }
}
