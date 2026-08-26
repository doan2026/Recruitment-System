package com.recruitment.auth.registration.api;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public final class VerifyOtpRequest {
  @NotBlank
  @Size(max = 320)
  private final String email;

  @NotNull
  private final UUID registrationId;

  @NotBlank
  @Pattern(regexp = "[0-9]{6}", message = "otp must contain exactly 6 digits")
  private final String otp;

  @JsonCreator
  public VerifyOtpRequest(
      @JsonProperty("email") String email,
      @JsonProperty("registrationId") UUID registrationId,
      @JsonProperty("otp") String otp) {
    this.email = email;
    this.registrationId = registrationId;
    this.otp = otp;
  }

  public String email() {
    return email;
  }

  public UUID registrationId() {
    return registrationId;
  }

  public String otp() {
    return otp;
  }

  @Override
  public String toString() {
    return "VerifyOtpRequest[email=<redacted>, registrationId=<redacted>, otp=<redacted>]";
  }
}
