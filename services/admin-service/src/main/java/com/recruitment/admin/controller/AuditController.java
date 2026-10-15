package com.recruitment.admin.controller;

import com.recruitment.admin.dto.common.ApiResponse;
import com.recruitment.admin.dto.moderation.AuditResponse;
import com.recruitment.admin.service.AuditService;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@SecurityRequirement(name = "bearerAuth")
public class AuditController {
  private final AuditService audit;

  public AuditController(AuditService audit) {
    this.audit = audit;
  }

  @GetMapping("/audit-logs")
  public ApiResponse<List<AuditResponse>> list(@AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
      @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit) {
    return audit.list(jwt, page, limit);
  }
}
