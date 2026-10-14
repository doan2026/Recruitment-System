package com.recruitment.auth.dto.registration;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public final class RegisterRequest {
  @NotBlank
  @Size(max = 320)
  private final String email;

  @NotNull
  @Size(max = 128)
  private final String password;

  @NotNull
  private final RegistrationRole role;

  @JsonCreator
  public RegisterRequest(
      @JsonProperty("email") String email,
      @JsonProperty("password") String password,
      @JsonProperty("role") RegistrationRole role) {
    this.email = email;
    this.password = password;
    this.role = role;
  }

  public String email() {
    return email;
  }

  public String password() {
    return password;
  }

  public RegistrationRole role() {
    return role;
  }

  @Override
  public String toString() {
    return "RegisterRequest[email=<redacted>, password=<redacted>, role=" + role + "]";
  }
}
