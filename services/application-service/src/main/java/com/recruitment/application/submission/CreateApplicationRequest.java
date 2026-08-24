package com.recruitment.application.submission;

import com.recruitment.application.domain.ApplicationSource;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record CreateApplicationRequest(
    @NotNull UUID jobId,
    @NotNull UUID cvId,
    @Size(max = 2000) String coverLetter,
    ApplicationSource source
) {}
