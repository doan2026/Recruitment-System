package com.recruitment.application.matching;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

public record RefreshMatchScoreRequest(
    @NotNull(message = "expectedVersion is required")
    @PositiveOrZero(message = "expectedVersion must not be negative")
    @Schema(example = "0", minimum = "0")
    Long expectedVersion
) {}
