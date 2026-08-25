package com.recruitment.application.evaluation;

import com.recruitment.application.domain.EvaluationEntity;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public record EvaluationResponse(
    UUID id,
    UUID applicationId,
    UUID evaluatorId,
    BigDecimal score,
    Map<String, BigDecimal> criteria,
    String note,
    Instant createdAt
) {
    static EvaluationResponse from(EvaluationEntity evaluation) {
        return new EvaluationResponse(
            evaluation.getId(),
            evaluation.getApplicationId(),
            evaluation.getEvaluatorId(),
            evaluation.getScore(),
            Collections.unmodifiableMap(
                new LinkedHashMap<>(evaluation.getCriteria())
            ),
            evaluation.getNote(),
            evaluation.getCreatedAt()
        );
    }
}
