package com.recruitment.application.usage;

import java.time.Instant;
import java.util.UUID;

public record CvUsageLookupResponse(
    UUID candidateId,
    UUID cvId,
    boolean used,
    Instant firstUsedAt,
    long applicationCount
) {}
