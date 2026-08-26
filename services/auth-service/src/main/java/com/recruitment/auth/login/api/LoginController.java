package com.recruitment.auth.login.api;

import com.recruitment.auth.api.ApiResponse;
import com.recruitment.auth.login.LoginService;
import com.recruitment.auth.token.api.AuthTokenResponse;
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
