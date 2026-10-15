package com.recruitment.auth.dto.passwordreset;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ResetPasswordRequest(
    @NotBlank @Size(max = 512) String token,
    @NotBlank @Size(max = 128) String newPassword) {
  @Override
  public String toString() {
    return "ResetPasswordRequest[token=<redacted>, newPassword=<redacted>]";
  }
}
