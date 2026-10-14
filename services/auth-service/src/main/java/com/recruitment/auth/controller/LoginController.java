package com.recruitment.auth.controller;

import com.recruitment.auth.dto.common.ApiResponse;
import com.recruitment.auth.dto.login.LoginRequest;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.service.login.LoginService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class LoginController {
  private final LoginService login;

  public LoginController(LoginService login) {
    this.login = login;
  }

  @PostMapping("/login")
  public ResponseEntity<ApiResponse<AuthTokenResponse>> login(
      @Valid @RequestBody LoginRequest request) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store, no-cache")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .header(HttpHeaders.EXPIRES, "0")
        .body(ApiResponse.of(login.login(request)));
  }
}
