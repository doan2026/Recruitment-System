package com.recruitment.auth.passwordreset.api;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ForgotPasswordRequest(
    @NotBlank @Email @Size(max = 320) String email) {
  @Override
  public String toString() {
    return "ForgotPasswordRequest[email=<redacted>]";
  }
}
