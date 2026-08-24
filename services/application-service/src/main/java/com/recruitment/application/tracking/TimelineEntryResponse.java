package com.recruitment.application.tracking;

import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;

public record TimelineEntryResponse(
    ApplicationStatus fromStatus,
    ApplicationStatus toStatus,
    String note,
    Instant changedAt
) {}
