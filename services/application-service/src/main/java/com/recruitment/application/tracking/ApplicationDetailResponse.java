package com.recruitment.application.tracking;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ApplicationDetailResponse(
    UUID id,
    UUID jobId,
    UUID companyId,
    UUID candidateId,
    UUID recruiterId,
    UUID cvId,
    String jobTitle,
    String coverLetter,
    ApplicationStatus status,
    ApplicationSource source,
    BigDecimal matchScore,
    Instant appliedAt,
    Instant updatedAt,
    long version,
    List<TimelineEntryResponse> timeline,
    UUID offerId
) {
    static ApplicationDetailResponse from(
        ApplicationEntity application,
        List<TimelineEntryResponse> timeline
    ) {
        return from(application, timeline, null);
    }

    static ApplicationDetailResponse from(
        ApplicationEntity application,
        List<TimelineEntryResponse> timeline,
        UUID offerId
    ) {
        return new ApplicationDetailResponse(
            application.getId(),
            application.getJobId(),
            application.getCompanyId(),
            application.getCandidateId(),
            application.getRecruiterId(),
            application.getCvId(),
            application.getJobTitle(),
            application.getCoverLetter(),
            application.getStatus(),
            application.getSource(),
            application.getMatchScore(),
            application.getAppliedAt(),
            application.getUpdatedAt(),
            application.getVersion(),
            timeline,
            offerId
        );
    }
}
