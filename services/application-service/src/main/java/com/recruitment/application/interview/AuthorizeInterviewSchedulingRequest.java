package com.recruitment.application.interview;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = false)
public record AuthorizeInterviewSchedulingRequest(
    @NotNull UUID applicationId
) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException(
            "Unknown interview authorization field: " + field
        );
    }
}
