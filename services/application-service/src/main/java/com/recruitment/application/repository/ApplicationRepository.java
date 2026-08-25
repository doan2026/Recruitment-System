package com.recruitment.application.repository;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationStatus;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
        update ApplicationEntity application
        set application.matchScore = :matchScore,
            application.version = application.version + 1
        where application.id = :applicationId
          and application.version = :expectedVersion
        """)
    int updateMatchScore(
        @Param("applicationId") UUID applicationId,
        @Param("matchScore") BigDecimal matchScore,
        @Param("expectedVersion") long expectedVersion
    );
}
