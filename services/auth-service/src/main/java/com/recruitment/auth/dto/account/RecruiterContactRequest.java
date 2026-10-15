package com.recruitment.auth.dto.account;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RecruiterContactRequest(
    @NotBlank @Size(min = 2, max = 160) String fullName,
    @NotBlank @Pattern(regexp = "^[0-9+(). -]{6,32}$")
    @Pattern(regexp = "^(?:\\D*\\d){6,15}\\D*$") String phone) {
  @Override
  public String toString() {
    return "RecruiterContactRequest[fullName=<redacted>, phone=<redacted>]";
  }
}
