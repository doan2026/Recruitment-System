package com.recruitment.application.interview;

import com.recruitment.application.domain.ApplicationStatus;
import java.util.UUID;

public record InterviewSchedulingContextResponse(
    UUID applicationId,
    UUID jobId,
    UUID companyId,
    UUID candidateId,
    ApplicationStatus status,
    long applicationVersion
) {}
