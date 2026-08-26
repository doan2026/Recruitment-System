package com.recruitment.auth.account.api;

import com.recruitment.auth.account.CurrentAccountService;
import com.recruitment.auth.api.ApiResponse;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
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
}
