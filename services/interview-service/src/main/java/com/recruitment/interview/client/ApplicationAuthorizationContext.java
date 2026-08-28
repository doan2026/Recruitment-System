package com.recruitment.interview.client;

import java.util.UUID;

public record ApplicationAuthorizationContext(
    UUID applicationId,
    UUID jobId,
    UUID companyId,
    UUID candidateId,
    String status,
    long applicationVersion
) {}
