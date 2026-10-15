package com.recruitment.auth.controller;

import com.recruitment.auth.dto.account.CurrentAccountResponse;
import com.recruitment.auth.dto.account.RecruiterContactRequest;
import com.recruitment.auth.dto.account.RecruiterContactResponse;
import com.recruitment.auth.dto.common.ApiResponse;
import com.recruitment.auth.service.account.CurrentAccountService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class CurrentAccountController {
  private final CurrentAccountService accounts;

  public CurrentAccountController(CurrentAccountService accounts) {
    this.accounts = accounts;
  }

  @GetMapping("/me")
  public ResponseEntity<ApiResponse<CurrentAccountResponse>> me(
      @AuthenticationPrincipal Jwt jwt) {
    CurrentAccountResponse account = accounts.get(UUID.fromString(jwt.getSubject()));
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .body(ApiResponse.of(account));
  }

  @GetMapping("/me/recruiter-contact")
  public ResponseEntity<ApiResponse<RecruiterContactResponse>> recruiterContact(@AuthenticationPrincipal Jwt jwt) {
    return privateContact(accounts.getRecruiterContact(UUID.fromString(jwt.getSubject())));
  }

  @PutMapping("/me/recruiter-contact")
  public ResponseEntity<ApiResponse<RecruiterContactResponse>> updateRecruiterContact(
      @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RecruiterContactRequest request) {
    return privateContact(accounts.updateRecruiterContact(UUID.fromString(jwt.getSubject()), request));
  }

  private ResponseEntity<ApiResponse<RecruiterContactResponse>> privateContact(RecruiterContactResponse contact) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .body(ApiResponse.of(contact));
  }
}
