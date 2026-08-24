package com.recruitment.application.bookmark;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record CreateBookmarkRequest(
    @NotNull(message = "jobId is required") UUID jobId
) {}
