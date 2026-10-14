package com.recruitment.auth.controller;

import com.recruitment.auth.dto.accountcontrol.AdminUserResponse;
import com.recruitment.auth.dto.common.ApiResponse;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.service.accountcontrol.AdminUserDirectoryService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AdminUserDirectoryController {
  private final AdminUserDirectoryService directory;

  public AdminUserDirectoryController(AdminUserDirectoryService directory) {
    this.directory = directory;
  }

  @GetMapping("/auth/users")
  public ApiResponse<List<AdminUserResponse>> list(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "") String email,
      @RequestParam(required = false) UserRole role,
      @RequestParam(required = false) Boolean locked,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "20") int limit) {
    var result = directory.list(UUID.fromString(jwt.getSubject()), email, role, locked, page, limit);
    return new ApiResponse<>(result.getContent(), Map.of(
        "page", page, "limit", limit, "total", result.getTotalElements()));
  }
}
