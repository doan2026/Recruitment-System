package com.recruitment.interview.repository;

import com.recruitment.interview.domain.InterviewEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InterviewRepository
    extends JpaRepository<InterviewEntity, UUID> {

    Optional<InterviewEntity> findByScheduledByAndRequestId(
        UUID scheduledBy,
        UUID requestId
    );
}
