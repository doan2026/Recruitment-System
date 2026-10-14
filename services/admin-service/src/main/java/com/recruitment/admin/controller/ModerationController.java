package com.recruitment.admin.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.recruitment.admin.dto.moderation.RejectJobRequest;
import com.recruitment.admin.dto.moderation.UpdateUserLockRequest;
import com.recruitment.admin.dto.moderation.VerifyCompanyRequest;
import com.recruitment.admin.service.AdminQueryService;
import com.recruitment.admin.service.ModerationService;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@SecurityRequirement(name = "bearerAuth")
public class ModerationController {
  private final AdminQueryService queries;
  private final ModerationService moderation;

  public ModerationController(AdminQueryService queries, ModerationService moderation) {
    this.queries = queries;
    this.moderation = moderation;
  }

  @GetMapping("/companies/pending")
  public JsonNode companies(@AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
      @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit) {
    return queries.pendingCompanies(jwt, page, limit);
  }

  @PatchMapping("/companies/{id}/verify")
  public JsonNode verify(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
      @Valid @RequestBody VerifyCompanyRequest request) {
    return moderation.verifyCompany(jwt, id, request);
  }

  @GetMapping("/jobs/pending")
  public JsonNode jobs(@AuthenticationPrincipal Jwt jwt) {
    return queries.pendingJobs(jwt);
  }

  @PatchMapping("/jobs/{id}/approve")
  public JsonNode approve(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
    return moderation.approveJob(jwt, id);
  }

  @PatchMapping("/jobs/{id}/reject")
  public JsonNode reject(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
      @Valid @RequestBody RejectJobRequest request) {
    return moderation.rejectJob(jwt, id, request);
  }

  @GetMapping("/users")
  public JsonNode users(@AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "") @Size(max = 200) String email,
      @RequestParam(required = false) @Pattern(regexp = "CANDIDATE|RECRUITER|ADMIN") String role,
      @RequestParam(required = false) Boolean locked,
      @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
      @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit) {
    return queries.users(jwt, email, role, locked, page, limit);
  }

  @PatchMapping("/users/{id}/lock")
  public JsonNode lock(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
      @Valid @RequestBody UpdateUserLockRequest request) {
    return moderation.lockUser(jwt, id, request);
  }
}
