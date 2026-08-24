package com.recruitment.application.repository;

import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApplicationEventOutboxRepository
    extends JpaRepository<ApplicationEventOutboxEntity, UUID> {

    List<ApplicationEventOutboxEntity>
        findTop100ByPublishedAtIsNullAndNextAttemptAtLessThanEqualOrderByCreatedAtAsc(
            Instant now
        );
}
