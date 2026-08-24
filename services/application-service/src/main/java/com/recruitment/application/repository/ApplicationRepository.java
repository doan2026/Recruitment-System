package com.recruitment.application.repository;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationStatus;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApplicationRepository
    extends JpaRepository<ApplicationEntity, UUID> {

    boolean existsByCandidateIdAndJobIdAndStatusIn(
        UUID candidateId,
        UUID jobId,
        Collection<ApplicationStatus> statuses
    );

    Optional<ApplicationEntity>
        findFirstByCandidateIdAndJobIdOrderByAppliedAtDesc(
            UUID candidateId,
            UUID jobId
        );
}
