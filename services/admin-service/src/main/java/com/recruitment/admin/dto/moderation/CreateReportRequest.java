package com.recruitment.admin.dto.moderation;

import jakarta.validation.constraints.*;
import java.util.UUID;

public record CreateReportRequest(
    @NotNull @Pattern(regexp = "JOB|COMPANY|USER") String targetType,
    @NotNull UUID targetId,
    @NotBlank @Size(min = 3, max = 1000) String reason,
    @Size(max = 5000) String description
  ) {}
