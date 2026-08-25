package com.recruitment.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(
    name = "evaluations",
    uniqueConstraints = @UniqueConstraint(
        name = "evaluations_application_evaluator_unique",
        columnNames = {"application_id", "evaluator_id"}
    )
)
public class EvaluationEntity {
    @Id
    private UUID id;

    @Column(name = "application_id", nullable = false)
    private UUID applicationId;

    @Column(name = "evaluator_id", nullable = false)
    private UUID evaluatorId;

    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal score;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "criteria_json", nullable = false, columnDefinition = "jsonb")
    private Map<String, BigDecimal> criteria;

    @Column(length = 2000)
    private String note;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected EvaluationEntity() {}

    public static EvaluationEntity create(
        UUID id,
        UUID applicationId,
        UUID evaluatorId,
        BigDecimal score,
        Map<String, BigDecimal> criteria,
        String note,
        Instant createdAt
    ) {
        EvaluationEntity evaluation = new EvaluationEntity();
        evaluation.id = id;
        evaluation.applicationId = applicationId;
        evaluation.evaluatorId = evaluatorId;
        evaluation.score = score;
        evaluation.criteria = new LinkedHashMap<>(criteria);
        evaluation.note = note;
        evaluation.createdAt = createdAt;
        return evaluation;
    }

    public UUID getId() {
        return id;
    }

    public UUID getApplicationId() {
        return applicationId;
    }

    public UUID getEvaluatorId() {
        return evaluatorId;
    }

    public BigDecimal getScore() {
        return score;
    }

    public Map<String, BigDecimal> getCriteria() {
        return Collections.unmodifiableMap(criteria);
    }

    public String getNote() {
        return note;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
