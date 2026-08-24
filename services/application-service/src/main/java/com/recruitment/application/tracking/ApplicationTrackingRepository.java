package com.recruitment.application.tracking;

import com.recruitment.application.domain.ApplicationEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApplicationTrackingRepository
    extends JpaRepository<ApplicationEntity, UUID> {

    List<ApplicationEntity> findAllByCandidateIdOrderByAppliedAtDesc(
        UUID candidateId
    );
}
