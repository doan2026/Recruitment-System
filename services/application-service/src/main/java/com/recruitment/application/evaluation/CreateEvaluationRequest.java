package com.recruitment.application.evaluation;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.Map;

public record CreateEvaluationRequest(
    @NotNull(message = "score is required")
    @DecimalMin(value = "0", message = "score must be between 0 and 100")
    @DecimalMax(value = "100", message = "score must be between 0 and 100")
    @Digits(
        integer = 3,
        fraction = 2,
        message = "score must have at most 2 decimal places"
    )
    @Schema(example = "85.50", minimum = "0", maximum = "100")
    BigDecimal score,

    @NotEmpty(message = "criteria must contain at least one item")
    @Size(max = 20, message = "criteria must contain at most 20 items")
    @Valid
    @Schema(
        description = "Named evaluation criteria scored from 0 to 100",
        example = "{\"technical\": 90, \"communication\": 80}"
    )
    Map<
        @NotBlank(message = "criteria name must not be blank")
        @Size(
            max = 100,
            message = "criteria name must not exceed 100 characters"
        )
        String,
        @NotNull(message = "criteria score is required")
        @DecimalMin(
            value = "0",
            message = "criteria score must be between 0 and 100"
        )
        @DecimalMax(
            value = "100",
            message = "criteria score must be between 0 and 100"
        )
        @Digits(
            integer = 3,
            fraction = 2,
            message = "criteria score must have at most 2 decimal places"
        )
        BigDecimal
    > criteria,

    @Size(max = 2000, message = "note must not exceed 2000 characters")
    @Schema(maxLength = 2000)
    String note
) {}
