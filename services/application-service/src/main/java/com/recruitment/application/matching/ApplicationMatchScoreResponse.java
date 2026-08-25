package com.recruitment.application.matching;

import java.math.BigDecimal;
import java.util.UUID;

public record ApplicationMatchScoreResponse(
    UUID applicationId,
    BigDecimal matchScore,
    long version
) {}
