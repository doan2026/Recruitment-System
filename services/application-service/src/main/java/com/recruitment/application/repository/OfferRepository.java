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
}
