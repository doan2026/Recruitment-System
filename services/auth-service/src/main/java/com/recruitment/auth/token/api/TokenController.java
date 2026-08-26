package com.recruitment.auth.token.api;

import com.recruitment.auth.api.ApiResponse;
import com.recruitment.auth.token.TokenSessionService;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class TokenController {
  private final TokenSessionService tokenSessions;

  TokenController(TokenSessionService tokenSessions) {
    this.tokenSessions = tokenSessions;
  }

  @PostMapping("/refresh")
  ResponseEntity<ApiResponse<AuthTokenResponse>> refresh(
      @Valid @RequestBody RefreshTokenRequest request) {
    return ResponseEntity.ok()
        .headers(noStoreHeaders())
        .body(ApiResponse.of(tokenSessions.refresh(request.refreshToken())));
  }

  @PostMapping("/logout")
  ResponseEntity<Void> logout(@Valid @RequestBody RefreshTokenRequest request) {
    tokenSessions.logout(request.refreshToken());
    return ResponseEntity.noContent()
        .headers(noStoreHeaders())
        .build();
  }

  private static HttpHeaders noStoreHeaders() {
    HttpHeaders headers = new HttpHeaders();
    headers.setCacheControl(CacheControl.noStore());
    headers.setPragma("no-cache");
    return headers;
  }
}
