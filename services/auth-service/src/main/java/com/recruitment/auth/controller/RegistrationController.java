package com.recruitment.auth.controller;

import com.recruitment.auth.dto.common.ApiResponse;
import com.recruitment.auth.dto.registration.OtpDispatchResponse;
import com.recruitment.auth.dto.registration.RegisterRequest;
import com.recruitment.auth.dto.registration.RegistrationResponse;
import com.recruitment.auth.dto.registration.ResendOtpRequest;
import com.recruitment.auth.dto.registration.VerifyOtpRequest;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.service.registration.RegistrationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class RegistrationController {
  private final RegistrationService registration;

  public RegistrationController(RegistrationService registration) {
    this.registration = registration;
  }

  @PostMapping("/register")
  public ResponseEntity<ApiResponse<RegistrationResponse>> register(
      @Valid @RequestBody RegisterRequest request) {
    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .body(ApiResponse.of(registration.register(request)));
  }

  @PostMapping("/otp/resend")
  public ResponseEntity<ApiResponse<OtpDispatchResponse>> resend(
      @Valid @RequestBody ResendOtpRequest request) {
    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .body(ApiResponse.of(registration.resend(request)));
  }

  @PostMapping("/otp/verify")
  public ResponseEntity<ApiResponse<AuthTokenResponse>> verify(
      @Valid @RequestBody VerifyOtpRequest request) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store, no-cache")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .header(HttpHeaders.EXPIRES, "0")
        .body(ApiResponse.of(registration.verify(request)));
  }
}
