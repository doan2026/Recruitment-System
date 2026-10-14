package com.recruitment.admin.service;

import com.recruitment.admin.dto.common.ApiResponse;
import com.recruitment.admin.dto.moderation.AuditResponse;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.repository.ModerationRepository;
import java.util.List;
import java.util.Map;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
  private final ServiceGateway gateway;
  private final ModerationRepository store;

  public AuditService(ServiceGateway gateway, ModerationRepository store) {
    this.gateway = gateway;
    this.store = store;
  }

  public ApiResponse<List<AuditResponse>> list(Jwt actor, int page, int limit) {
    gateway.requireCurrentAdmin(actor);
    return new ApiResponse<>(store.auditEntries(page, limit).stream().map(AuditResponse::from).toList(),
        Map.of("page", page, "limit", limit));
  }
}
