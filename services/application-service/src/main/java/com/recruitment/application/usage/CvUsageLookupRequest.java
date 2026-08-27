package com.recruitment.application.usage;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = false)
public record CvUsageLookupRequest(
    @NotNull UUID candidateId,
    @NotNull UUID cvId
) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException(
            "Unknown CV usage lookup field: " + field
        );
    }
}
