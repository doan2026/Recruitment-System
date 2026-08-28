package com.recruitment.application.usage;

import java.time.Instant;
import java.util.UUID;

public record CvDeletionFenceResponse(
    UUID candidateId,
    UUID cvId,
    UUID deletionRequestId,
    CvDeletionFenceDisposition disposition,
    Instant fencedAt,
    Instant firstUsedAt,
    long applicationCount
) {}
