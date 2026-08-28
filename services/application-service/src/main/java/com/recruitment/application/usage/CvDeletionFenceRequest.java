package com.recruitment.application.usage;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = false)
public record CvDeletionFenceRequest(
    @NotNull UUID candidateId,
    @NotNull UUID cvId,
    @NotNull UUID deletionRequestId
) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException(
            "Unknown CV deletion fence field: " + field
        );
    }
}
