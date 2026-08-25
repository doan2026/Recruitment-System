package com.recruitment.application.offer;

import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record CreateOfferRequest(
    @NotNull(message = "salary is required")
    @DecimalMin(
        value = "0.01",
        message = "salary must be greater than zero"
    )
    @Digits(
        integer = 17,
        fraction = 2,
        message = "salary must have at most 2 decimal places"
    )
    @Schema(example = "25000000.00", minimum = "0.01")
    BigDecimal salary,

    @NotNull(message = "startDate is required")
    @FutureOrPresent(message = "startDate must not be in the past")
    @Schema(example = "2026-09-15")
    LocalDate startDate,

    @NotBlank(message = "position is required")
    @Size(max = 200, message = "position must not exceed 200 characters")
    @Schema(example = "Senior Backend Engineer", maxLength = 200)
    String position,

    @Size(max = 2000, message = "note must not exceed 2000 characters")
    @Schema(maxLength = 2000)
    String note,

    @Schema(description = "Confirmed offer-letter file identifier")
    UUID fileId,

    @Size(max = 2048, message = "fileUrl must not exceed 2048 characters")
    @Schema(
        description = "Canonical absolute HTTP(S) URL for the offer letter",
        example = "https://res.cloudinary.com/example/offer.pdf"
    )
    String fileUrl,

    @NotNull(message = "expiresAt is required")
    @Future(message = "expiresAt must be in the future")
    @Schema(example = "2026-09-05T17:00:00Z")
    Instant expiresAt,

    @NotNull(message = "expectedApplicationVersion is required")
    @PositiveOrZero(
        message = "expectedApplicationVersion must not be negative"
    )
    Long expectedApplicationVersion
) {
    @JsonIgnore
    @AssertTrue(
        message = "fileId and fileUrl must either both be provided or both be absent"
    )
    public boolean isFileReferenceComplete() {
        boolean hasFileId = fileId != null;
        boolean hasFileUrl = fileUrl != null && !fileUrl.isBlank();
        return hasFileId == hasFileUrl;
    }
}
