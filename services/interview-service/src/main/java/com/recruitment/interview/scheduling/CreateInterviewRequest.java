package com.recruitment.interview.scheduling;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.recruitment.interview.domain.InterviewMode;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.UUID;

public record CreateInterviewRequest(
    @NotNull UUID applicationId,
    @NotNull UUID requestId,
    @Min(1) @Max(20) int roundNumber,
    @NotNull
    @JsonFormat(without = JsonFormat.Feature.ADJUST_DATES_TO_CONTEXT_TIME_ZONE)
    OffsetDateTime scheduledStart,
    @NotBlank @Size(max = 100) String timeZone,
    @Min(30) @Max(60) int durationMinutes,
    @NotNull InterviewMode mode,
    @Size(max = 500) String location,
    @Size(max = 2000) String notes
) {}
