package com.recruitment.application.pipeline;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record RecruiterApplicationItemResponse(
    UUID id,
    UUID jobId,
    UUID candidateId,
    UUID cvId,
    String jobTitle,
    ApplicationStatus status,
    ApplicationSource source,
    BigDecimal matchScore,
    Instant appliedAt,
    Instant updatedAt,
    long version
) {
    static RecruiterApplicationItemResponse from(
        ApplicationEntity application
    ) {
        return new RecruiterApplicationItemResponse(
            application.getId(),
            application.getJobId(),
            application.getCandidateId(),
            application.getCvId(),
            application.getJobTitle(),
            application.getStatus(),
            application.getSource(),
            application.getMatchScore(),
            application.getAppliedAt(),
            application.getUpdatedAt(),
            application.getVersion()
        );
    }
}
