package com.recruitment.application.pipeline;

import com.recruitment.application.domain.ApplicationStatus;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record ChangeApplicationStatusRequest(
    @NotNull(message = "status is required") ApplicationStatus status,
    @Size(max = 2000, message = "note must not exceed 2000 characters")
    String note,
    @NotNull(message = "expectedVersion is required")
    @PositiveOrZero(message = "expectedVersion must not be negative")
    Long expectedVersion
) {}
