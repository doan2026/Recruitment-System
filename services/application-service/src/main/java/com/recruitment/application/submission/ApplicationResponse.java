package com.recruitment.application.submission;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;
import java.util.UUID;

public record ApplicationResponse(
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
    Instant appliedAt,
    long version
) {
    static ApplicationResponse from(ApplicationEntity application) {
        return new ApplicationResponse(
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
            application.getAppliedAt(),
            application.getVersion()
        );
    }
}
