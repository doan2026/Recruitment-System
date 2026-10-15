package com.recruitment.admin.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.recruitment.admin.dto.moderation.RejectJobRequest;
import com.recruitment.admin.dto.moderation.UpdateUserLockRequest;
import com.recruitment.admin.dto.moderation.VerifyCompanyRequest;
import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.repository.ModerationRepository;
import com.recruitment.admin.support.ModerationReason;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpMethod;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
public class ModerationService {
  private final ServiceGateway gateway;
  private final ModerationRepository store;

  public ModerationService(ServiceGateway gateway, ModerationRepository store) {
    this.gateway = gateway;
    this.store = store;
  }

  public JsonNode verifyCompany(Jwt actor, UUID id, VerifyCompanyRequest request) {
    String reason = "REJECT".equals(request.decision()) ? ModerationReason.require(request.reason()) : null;
    Object body = reason == null ? Map.of("decision", request.decision())
        : Map.of("decision", request.decision(), "reason", reason);
    return mutate(actor, "COMPANY", id, "VERIFY_COMPANY", "/" + id + "/verify", body, reason);
  }

  public JsonNode approveJob(Jwt actor, UUID id) {
    return mutate(actor, "JOB", id, "APPROVE_JOB", "/" + id + "/approve", Map.of(), null);
  }

  public JsonNode rejectJob(Jwt actor, UUID id, RejectJobRequest request) {
    String reason = ModerationReason.require(request.reason());
    return mutate(actor, "JOB", id, "REJECT_JOB", "/" + id + "/reject", Map.of("reason", reason), reason);
  }

  public JsonNode lockUser(Jwt actor, UUID id, UpdateUserLockRequest request) {
    String reason = request.locked() ? ModerationReason.require(request.reason()) : null;
    return mutate(actor, "AUTH", id, request.locked() ? "LOCK_USER" : "UNLOCK_USER",
        "/auth/users/" + id + "/lock",
        request.locked() ? Map.of("locked", true, "reason", reason) : Map.of("locked", false), reason);
  }

  public JsonNode mutate(Jwt actor, String service, UUID target, String action, String path, Object body, String reason) {
    gateway.requireCurrentAdmin(actor);
    UUID operation = UUID.randomUUID();
    UUID admin = UUID.fromString(actor.getSubject());
    // The repository commits intent before the remote call and appends the outcome afterward.
    store.audit(operation, admin, action, service, target, reason, "STARTED");
    try {
      JsonNode result = gateway.call(service, HttpMethod.PATCH, path, body, actor);
      store.audit(operation, admin, action, service, target, reason, "SUCCEEDED");
      return result;
    } catch (AdminFailure error) {
      store.audit(operation, admin, action, service, target, reason, error.status() >= 500 ? "UNKNOWN" : "FAILED");
      throw error;
    }
  }
}
