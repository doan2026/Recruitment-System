package com.recruitment.auth.passwordreset.api;

import com.recruitment.auth.api.ApiResponse;
import com.recruitment.auth.passwordreset.PasswordResetService;
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
public class PasswordResetController {
  private final PasswordResetService passwordReset;

  public PasswordResetController(PasswordResetService passwordReset) {
    this.passwordReset = passwordReset;
  }

  @PostMapping("/forgot-password")
  public ResponseEntity<ApiResponse<ForgotPasswordResponse>> forgot(
      @Valid @RequestBody ForgotPasswordRequest request) {
    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .header(HttpHeaders.CACHE_CONTROL, "no-store, no-cache")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .header(HttpHeaders.EXPIRES, "0")
        .body(ApiResponse.of(passwordReset.forgot(request)));
  }

  @PostMapping("/reset-password")
  public ResponseEntity<Void> reset(
      @Valid @RequestBody ResetPasswordRequest request) {
    passwordReset.reset(request);
    return ResponseEntity.noContent()
        .header(HttpHeaders.CACHE_CONTROL, "no-store, no-cache")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .header(HttpHeaders.EXPIRES, "0")
        .build();
  }
}
