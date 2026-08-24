package com.recruitment.application.pipeline;

import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;
import java.util.UUID;

public record StatusTransitionResponse(
    UUID applicationId,
    ApplicationStatus fromStatus,
    ApplicationStatus toStatus,
    Instant updatedAt,
    long version
) {}
