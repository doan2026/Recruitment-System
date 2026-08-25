package com.recruitment.application.offer;

import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record RespondOfferRequest(
    @NotNull(message = "decision is required")
    OfferDecision decision,

    @Size(
        max = 2000,
        message = "declineReason must not exceed 2000 characters"
    )
    @Schema(maxLength = 2000)
    String declineReason,

    @NotNull(message = "expectedOfferVersion is required")
    @PositiveOrZero(message = "expectedOfferVersion must not be negative")
    Long expectedOfferVersion,

    @NotNull(message = "expectedApplicationVersion is required")
    @PositiveOrZero(
        message = "expectedApplicationVersion must not be negative"
    )
    Long expectedApplicationVersion
) {
    @JsonIgnore
    @AssertTrue(message = "declineReason is required when decision is DECLINED")
    public boolean isDeclineReasonPresent() {
        return decision != OfferDecision.DECLINED ||
            declineReason != null && !declineReason.isBlank();
    }
}
