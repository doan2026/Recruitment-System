package com.recruitment.admin.model;

import java.time.Instant;
import java.util.UUID;

public record AuditEntry(UUID id, UUID operationId, UUID adminId, String action,
    String targetType, UUID targetId, String reason, String outcome, Instant createdAt) {}
