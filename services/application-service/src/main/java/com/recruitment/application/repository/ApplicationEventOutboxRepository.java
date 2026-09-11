package com.recruitment.application.repository;

import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApplicationEventOutboxRepository
    extends JpaRepository<ApplicationEventOutboxEntity, UUID> {

    /**
     * Claim at most one head event per aggregate. A predecessor in backoff or
     * locked by another publisher still blocks its successors. Locks last until
     * the publisher transaction records Kafka acknowledgement or the next retry.
     * Legacy events without a version drain before canonical versioned events.
     */
    @Query(value = """
        SELECT candidate.*
        FROM {h-schema}application_event_outbox candidate
        WHERE candidate.published_at IS NULL
          AND candidate.next_attempt_at <= :now
          AND NOT EXISTS (
              SELECT 1
              FROM {h-schema}application_event_outbox predecessor
              WHERE predecessor.aggregate_id = candidate.aggregate_id
                AND predecessor.published_at IS NULL
                AND (
                    COALESCE(predecessor.aggregate_version, -1),
                    predecessor.created_at,
                    predecessor.id
                ) < (
                    COALESCE(candidate.aggregate_version, -1),
                    candidate.created_at,
                    candidate.id
                )
          )
        ORDER BY candidate.created_at, candidate.id
        LIMIT 100
        FOR UPDATE OF candidate SKIP LOCKED
        """, nativeQuery = true)
    List<ApplicationEventOutboxEntity> lockNextPublishableBatch(@Param("now") Instant now);
}
