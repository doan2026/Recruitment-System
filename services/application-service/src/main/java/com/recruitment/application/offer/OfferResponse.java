package com.recruitment.application.offer;

import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.OfferEntity;
import com.recruitment.application.domain.OfferStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record OfferResponse(
    UUID id,
    UUID applicationId,
    UUID sentBy,
    BigDecimal salary,
    LocalDate startDate,
    String position,
    String note,
    UUID fileId,
    String fileUrl,
    OfferStatus status,
    Instant sentAt,
    Instant expiresAt,
    Instant respondedAt,
    String responseNote,
    long version,
    ApplicationStatus applicationStatus,
    long applicationVersion
) {
    static OfferResponse current(OfferEntity offer, ApplicationEntity application) {
        return responded(
            offer, offer.getStatus(), offer.getRespondedAt(),
            offer.getResponseNote(), offer.getVersion(),
            application.getStatus(), application.getVersion()
        );
    }

    static OfferResponse sent(
        OfferEntity offer,
        long applicationVersion
    ) {
        return new OfferResponse(
            offer.getId(),
            offer.getApplicationId(),
            offer.getSentBy(),
            offer.getSalary(),
            offer.getStartDate(),
            offer.getPosition(),
            offer.getNote(),
            offer.getFileId(),
            offer.getFileUrl(),
            offer.getStatus(),
            offer.getSentAt(),
            offer.getExpiresAt(),
            offer.getRespondedAt(),
            offer.getResponseNote(),
            offer.getVersion(),
            ApplicationStatus.OFFER,
            applicationVersion
        );
    }

    static OfferResponse responded(
        OfferEntity offer,
        OfferStatus status,
        Instant respondedAt,
        String responseNote,
        long offerVersion,
        ApplicationStatus applicationStatus,
        long applicationVersion
    ) {
        return new OfferResponse(
            offer.getId(),
            offer.getApplicationId(),
            offer.getSentBy(),
            offer.getSalary(),
            offer.getStartDate(),
            offer.getPosition(),
            offer.getNote(),
            offer.getFileId(),
            offer.getFileUrl(),
            status,
            offer.getSentAt(),
            offer.getExpiresAt(),
            respondedAt,
            responseNote,
            offerVersion,
            applicationStatus,
            applicationVersion
        );
    }
}
