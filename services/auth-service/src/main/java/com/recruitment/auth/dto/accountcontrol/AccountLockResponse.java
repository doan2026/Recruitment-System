package com.recruitment.auth.dto.accountcontrol;

import java.time.Instant;
import java.util.UUID;

public record AccountLockResponse(
    UUID userId,
    boolean locked,
    Instant lockedAt,
    long version,
    int revokedSessionCount) {}
