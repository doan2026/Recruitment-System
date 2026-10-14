package com.recruitment.auth.dto.accountcontrol;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.recruitment.auth.model.UserRole;
import java.sql.Timestamp;
import java.util.UUID;

/** Public directory projection. Never includes credentials or session data. */
public record AdminUserResponse(
    UUID id,
    String email,
    UserRole role,
    @JsonProperty("is_verified") boolean verified,
    @JsonProperty("is_locked") boolean locked,
    @JsonProperty("locked_reason") String lockedReason,
    @JsonProperty("created_at") Timestamp createdAt) {}
