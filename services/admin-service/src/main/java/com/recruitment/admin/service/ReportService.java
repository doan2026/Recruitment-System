package com.recruitment.admin.service;

import com.recruitment.admin.dto.common.ApiResponse;
import com.recruitment.admin.dto.moderation.CreateReportRequest;
import com.recruitment.admin.dto.moderation.ReportCreatedResponse;
import com.recruitment.admin.dto.moderation.ReportResolutionResponse;
import com.recruitment.admin.dto.moderation.ReportResponse;
import com.recruitment.admin.dto.moderation.ResolveReportRequest;
import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.repository.ModerationRepository;
import com.recruitment.admin.support.ModerationReason;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpMethod;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
  private final ServiceGateway gateway;
  private final ModerationRepository store;

  public ReportService(ServiceGateway gateway, ModerationRepository store) {
    this.gateway = gateway;
    this.store = store;
  }

  public ApiResponse<ReportCreatedResponse> create(Jwt actor, CreateReportRequest request) {
    UUID id = store.createReport(UUID.fromString(actor.getSubject()), request.targetType(), request.targetId(),
        ModerationReason.require(request.reason()), request.description());
    return ApiResponse.of(new ReportCreatedResponse(id, "OPEN", 0));
  }

  public ApiResponse<List<ReportResponse>> list(Jwt actor, String status, String type, int page, int limit) {
    gateway.requireCurrentAdmin(actor);
    var result = store.reports(status, type, page, limit);
    return new ApiResponse<>(result.items().stream().map(ReportResponse::from).toList(),
        Map.of("page", page, "limit", limit, "total", result.total()));
  }

  public ApiResponse<ReportResolutionResponse> resolve(Jwt actor, UUID id, ResolveReportRequest request) {
    gateway.requireCurrentAdmin(actor);
    UUID operation = UUID.randomUUID();
    UUID admin = UUID.fromString(actor.getSubject());
    var report = store.claim(id, request.expectedVersion(), admin, request.resolution(), operation);
    store.audit(operation, admin, "HANDLE_REPORT", "REPORT", id, request.resolution(), "STARTED");
    try {
      if ("RESOLVED".equals(request.status())) {
        if ("USER".equals(report.targetType())) {
          gateway.call("AUTH", HttpMethod.PATCH, "/auth/users/" + report.targetId() + "/lock",
              Map.of("locked", true, "reason", request.resolution()), actor);
        } else {
          throw new AdminFailure(409, "TAKEDOWN_CONTRACT_UNAVAILABLE");
        }
      }
      store.finish(id, operation, request.status());
      store.audit(operation, admin, "HANDLE_REPORT", "REPORT", id, request.resolution(), "SUCCEEDED");
    } catch (AdminFailure error) {
      // Ambiguous failures remain PROCESSING for reconciliation; definite rejection reopens the report.
      if (error.status() < 500) store.finish(id, operation, "OPEN");
      store.audit(operation, admin, "HANDLE_REPORT", "REPORT", id, request.resolution(),
          error.status() >= 500 ? "UNKNOWN" : "FAILED");
      throw error;
    }
    return ApiResponse.of(new ReportResolutionResponse(id, request.status()));
  }
}
