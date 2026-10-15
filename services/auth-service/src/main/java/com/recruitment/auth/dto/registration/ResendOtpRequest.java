package com.recruitment.auth.dto.registration;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public final class ResendOtpRequest {
  @NotBlank
  @Size(max = 320)
  private final String email;

  @NotNull
  private final UUID registrationId;

  @JsonCreator
  public ResendOtpRequest(
      @JsonProperty("email") String email,
      @JsonProperty("registrationId") UUID registrationId) {
    this.email = email;
    this.registrationId = registrationId;
  }

  public String email() {
    return email;
  }

  public UUID registrationId() {
    return registrationId;
  }

  @Override
  public String toString() {
    return "ResendOtpRequest[email=<redacted>, registrationId=<redacted>]";
  }
}
