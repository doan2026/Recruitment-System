package com.recruitment.application.offer;

import java.time.Clock;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Resolves Offers that stayed {@code SENT} past {@code expires_at}.
 *
 * <p>Every scan reads one clock instant and drains lapsed Offers in bounded
 * batches until a batch comes back short or the per-scan batch budget is
 * spent, which keeps a backlog from monopolising the scheduler thread. Batches
 * are claimed with {@code SKIP LOCKED}, so several replicas may scan
 * concurrently without expiring a row twice and without blocking a Candidate
 * response or a pipeline cancellation that already holds the row.</p>
 */
@Component
public class ApplicationOfferExpiryWorker {
    private static final Logger LOGGER =
        LoggerFactory.getLogger(ApplicationOfferExpiryWorker.class);
    private static final int MIN_BATCH_SIZE = 1;
    private static final int MAX_BATCH_SIZE = 1000;
    private static final int MIN_BATCHES_PER_SCAN = 1;
    private static final int MAX_BATCHES_PER_SCAN = 100;

    private final ApplicationOfferExpiryService expiry;
    private final Clock clock;
    private final int batchSize;
    private final int maxBatchesPerScan;

    @Autowired
    public ApplicationOfferExpiryWorker(
        ApplicationOfferExpiryService expiry,
        @Value("${application-offers.expiry-batch-size}") int batchSize,
        @Value("${application-offers.expiry-max-batches-per-scan}")
        int maxBatchesPerScan
    ) {
        this(expiry, Clock.systemUTC(), batchSize, maxBatchesPerScan);
    }

    ApplicationOfferExpiryWorker(
        ApplicationOfferExpiryService expiry,
        Clock clock,
        int batchSize,
        int maxBatchesPerScan
    ) {
        this.expiry = expiry;
        this.clock = clock;
        this.batchSize = clamp(batchSize, MIN_BATCH_SIZE, MAX_BATCH_SIZE);
        this.maxBatchesPerScan = clamp(
            maxBatchesPerScan,
            MIN_BATCHES_PER_SCAN,
            MAX_BATCHES_PER_SCAN
        );
    }

    @Scheduled(
        fixedDelayString = "${application-offers.expiry-scan-delay-ms}",
        initialDelayString =
            "${application-offers.expiry-scan-initial-delay-ms}"
    )
    public void expireOverdueOffers() {
        Instant scannedAt = clock.instant();
        int expired = 0;
        for (int batch = 0; batch < maxBatchesPerScan; batch++) {
            int changed;
            try {
                changed = expiry.expireBatch(scannedAt, batchSize);
            } catch (RuntimeException exception) {
                // The next scan retries from the same durable state; a failed
                // batch has rolled back and left every row SENT.
                LOGGER.warn(
                    "Could not expire overdue offers after {} row(s): {}",
                    expired,
                    rootMessage(exception)
                );
                return;
            }
            expired += changed;
            if (changed < batchSize) break;
        }
        if (expired > 0) {
            LOGGER.info("Expired {} overdue offer(s)", expired);
        }
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.min(Math.max(value, minimum), maximum);
    }

    private String rootMessage(RuntimeException exception) {
        Throwable current = exception;
        while (current.getCause() != null) current = current.getCause();
        return current.getMessage() == null
            ? current.getClass().getSimpleName()
            : current.getMessage();
    }
}
