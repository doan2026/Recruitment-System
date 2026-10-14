package com.recruitment.auth.dto.oauth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record GoogleOAuthExchangeRequest(
    @NotBlank
    @Pattern(regexp = "[A-Za-z0-9_-]{43}")
    String code,
    GoogleOAuthRole role) {

  @Override
  public String toString() {
    return "GoogleOAuthExchangeRequest[code=<redacted>, role=" + role + "]";
  }
}
