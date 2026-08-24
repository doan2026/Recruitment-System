package com.recruitment.application.tracking;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ApplicationListItemResponse(
    UUID id,
    UUID jobId,
    UUID companyId,
    String jobTitle,
    ApplicationStatus status,
    ApplicationSource source,
    BigDecimal matchScore,
    Instant appliedAt,
    Instant updatedAt
) {
    static ApplicationListItemResponse from(ApplicationEntity application) {
        return new ApplicationListItemResponse(
            application.getId(),
            application.getJobId(),
            application.getCompanyId(),
            application.getJobTitle(),
            application.getStatus(),
            application.getSource(),
            application.getMatchScore(),
            application.getAppliedAt(),
            application.getUpdatedAt()
        );
    }
}
