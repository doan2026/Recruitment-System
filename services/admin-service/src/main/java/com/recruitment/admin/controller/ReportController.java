package com.recruitment.admin.controller;

import com.recruitment.admin.dto.common.ApiResponse;
import com.recruitment.admin.dto.moderation.CreateReportRequest;
import com.recruitment.admin.dto.moderation.ReportCreatedResponse;
import com.recruitment.admin.dto.moderation.ReportResolutionResponse;
import com.recruitment.admin.dto.moderation.ReportResponse;
import com.recruitment.admin.dto.moderation.ResolveReportRequest;
import com.recruitment.admin.service.ReportService;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@SecurityRequirement(name = "bearerAuth")
public class ReportController {
  private final ReportService reports;

  public ReportController(ReportService reports) {
    this.reports = reports;
  }

  @PostMapping("/reports")
  @ResponseStatus(HttpStatus.CREATED)
  public ApiResponse<ReportCreatedResponse> create(@AuthenticationPrincipal Jwt jwt,
      @Valid @RequestBody CreateReportRequest request) {
    return reports.create(jwt, request);
  }

  @GetMapping("/reports")
  public ApiResponse<List<ReportResponse>> list(@AuthenticationPrincipal Jwt jwt,
      @RequestParam(required = false) @Pattern(regexp = "OPEN|PROCESSING|RESOLVED|DISMISSED") String status,
      @RequestParam(required = false) @Pattern(regexp = "JOB|COMPANY|USER") String type,
      @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
      @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit) {
    return reports.list(jwt, status, type, page, limit);
  }

  @PatchMapping("/reports/{id}")
  public ApiResponse<ReportResolutionResponse> resolve(@AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID id, @Valid @RequestBody ResolveReportRequest request) {
    return reports.resolve(jwt, id, request);
  }
}
