package com.recruitment.application.repository;

import com.recruitment.application.domain.OfferEntity;
import com.recruitment.application.domain.OfferStatus;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OfferRepository extends JpaRepository<OfferEntity, UUID> {
    Optional<OfferEntity> findByApplicationId(UUID applicationId);

    boolean existsByApplicationId(UUID applicationId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
        update OfferEntity offer
        set offer.status = :targetStatus,
            offer.respondedAt = :respondedAt,
            offer.responseNote = :responseNote,
            offer.version = offer.version + 1
        where offer.id = :offerId
          and offer.status =
              com.recruitment.application.domain.OfferStatus.SENT
          and offer.version = :expectedVersion
          and offer.expiresAt > :now
        """)
    int respond(
        @Param("offerId") UUID offerId,
        @Param("targetStatus") OfferStatus targetStatus,
        @Param("respondedAt") Instant respondedAt,
        @Param("responseNote") String responseNote,
        @Param("expectedVersion") long expectedVersion,
        @Param("now") Instant now
    );

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
        update OfferEntity offer
        set offer.status =
                com.recruitment.application.domain.OfferStatus.CANCELLED,
            offer.respondedAt = :cancelledAt,
            offer.responseNote = null,
            offer.version = offer.version + 1
        where offer.applicationId = :applicationId
          and offer.status =
              com.recruitment.application.domain.OfferStatus.SENT
          and offer.version = :expectedVersion
        """)
    int cancelSent(
        @Param("applicationId") UUID applicationId,
        @Param("cancelledAt") Instant cancelledAt,
        @Param("expectedVersion") long expectedVersion
    );

    /**
     * Claims one bounded batch of lapsed {@code SENT} Offers and resolves them
     * to {@code EXPIRED} in a single set-based statement.
     *
     * <p>The inner select claims rows with {@code FOR UPDATE SKIP LOCKED} over
     * the {@code offers_pending_expiry_idx} partial index, so concurrent
     * replicas each take a disjoint batch instead of blocking or expiring the
     * same row twice. {@code responded_at} is the row's own {@code expires_at}
     * rather than the scan clock, which keeps the outcome deterministic and
     * identical to the Flyway V10 backfill regardless of when the scan runs.
     * The statement never touches an Offer that a Candidate response or a
     * pipeline cancellation has already moved out of {@code SENT}.</p>
     *
     * <p>Native SQL does not inherit {@code hibernate.default_schema}, so the
     * table is qualified with the {@code {h-schema}} placeholder rather than
     * relying on the connection search path.</p>
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
        UPDATE {h-schema}offers AS target
        SET status = 'EXPIRED',
            responded_at = target.expires_at,
            response_note = NULL,
            version = target.version + 1
        WHERE target.id IN (
            SELECT claim.id
            FROM {h-schema}offers AS claim
            WHERE claim.status = 'SENT'
              AND claim.expires_at <= :scannedAt
            ORDER BY claim.expires_at
            LIMIT :batchSize
            FOR UPDATE SKIP LOCKED
        )
        """, nativeQuery = true)
    int expireOverdueBatch(
        @Param("scannedAt") Instant scannedAt,
        @Param("batchSize") int batchSize
    );
}
