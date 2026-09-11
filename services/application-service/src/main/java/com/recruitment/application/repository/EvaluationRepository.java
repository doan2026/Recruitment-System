package com.recruitment.application.repository;

import com.recruitment.application.domain.EvaluationEntity;
import java.util.UUID;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EvaluationRepository
    extends JpaRepository<EvaluationEntity, UUID> {

    List<EvaluationEntity> findAllByApplicationIdOrderByCreatedAtAscIdAsc(UUID applicationId);

    boolean existsByApplicationIdAndEvaluatorId(
        UUID applicationId,
        UUID evaluatorId
    );
}
