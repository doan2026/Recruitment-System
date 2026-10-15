package com.recruitment.admin.model;

import java.time.Instant;
import java.util.UUID;

public record Report(UUID id, UUID reporterId, String targetType, UUID targetId,
    String reason, String description, String status, int version, UUID handledBy,
    Instant handledAt, String resolution, UUID operationId, Instant createdAt) {}
