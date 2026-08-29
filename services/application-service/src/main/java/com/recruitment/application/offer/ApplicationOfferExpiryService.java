package com.recruitment.application.offer;

import com.recruitment.application.repository.OfferRepository;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Transactional unit for one Offer expiry batch.
 *
 * <p>Each batch commits on its own so a large backlog drains incrementally and
 * a single scan never holds row locks for longer than one bounded statement.
 * Expiry resolves the Offer row only: the Application keeps its {@code OFFER}
 * status so the terminal pipeline decision stays with the Recruiter or the
 * Candidate, and no {@code application-events} record is produced. The
 * canonical v1 contract carries neither an expiry action nor an
 * {@code EXPIRED} {@code offer_status}, so emitting one here would be rejected
 * by the Notification consumer.</p>
 */
@Service
public class ApplicationOfferExpiryService {
    private final OfferRepository offers;

    public ApplicationOfferExpiryService(OfferRepository offers) {
        this.offers = offers;
    }

    @Transactional
    public int expireBatch(Instant scannedAt, int batchSize) {
        return offers.expireOverdueBatch(scannedAt, batchSize);
    }
}
