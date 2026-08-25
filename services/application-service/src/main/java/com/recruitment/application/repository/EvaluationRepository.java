package com.recruitment.application.repository;

import com.recruitment.application.domain.EvaluationEntity;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EvaluationRepository
    extends JpaRepository<EvaluationEntity, UUID> {

    boolean existsByApplicationIdAndEvaluatorId(
        UUID applicationId,
        UUID evaluatorId
    );
}
