package com.recruitment.auth.controller;

import com.recruitment.auth.dto.accountcontrol.AccountLockResponse;
import com.recruitment.auth.dto.accountcontrol.UpdateAccountLockRequest;
import com.recruitment.auth.dto.common.ApiResponse;
import com.recruitment.auth.service.accountcontrol.AdminAccountControlService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth/users")
public class AdminAccountControlController {
  private final AdminAccountControlService accountControl;

  public AdminAccountControlController(AdminAccountControlService accountControl) {
    this.accountControl = accountControl;
  }

  @PatchMapping("/{userId}/lock")
  public ResponseEntity<ApiResponse<AccountLockResponse>> updateLock(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID userId,
      @Valid @RequestBody UpdateAccountLockRequest request) {
    AccountLockResponse result = accountControl.update(
        UUID.fromString(jwt.getSubject()), userId, request.locked(), request.reason());
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .body(ApiResponse.of(result));
  }
}
