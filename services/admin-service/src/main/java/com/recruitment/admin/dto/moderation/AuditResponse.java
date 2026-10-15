package com.recruitment.admin.dto.moderation;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.recruitment.admin.model.AuditEntry;
import java.sql.Timestamp;
import java.util.UUID;

public record AuditResponse(UUID id, @JsonProperty("operation_id") UUID operationId,
    @JsonProperty("admin_id") UUID adminId, String action,
    @JsonProperty("target_type") String targetType, @JsonProperty("target_id") UUID targetId,
    String reason, String outcome, @JsonProperty("created_at") Timestamp createdAt) {
  public static AuditResponse from(AuditEntry entry) {
    return new AuditResponse(entry.id(), entry.operationId(), entry.adminId(), entry.action(),
        entry.targetType(), entry.targetId(), entry.reason(), entry.outcome(), Timestamp.from(entry.createdAt()));
  }
}
