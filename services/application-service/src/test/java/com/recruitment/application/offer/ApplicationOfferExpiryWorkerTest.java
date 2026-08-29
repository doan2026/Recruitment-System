package com.recruitment.application.offer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.CannotAcquireLockException;

class ApplicationOfferExpiryWorkerTest {
    private static final Instant NOW = Instant.parse("2026-08-29T10:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private ApplicationOfferExpiryService expiry;

    @BeforeEach
    void setUp() {
        expiry = mock(ApplicationOfferExpiryService.class);
    }

    @Test
    void scansOneBatchWhenTheFirstBatchComesBackShort() {
        when(expiry.expireBatch(NOW, 50)).thenReturn(7);

        worker(50, 10).expireOverdueOffers();

        verify(expiry).expireBatch(NOW, 50);
        verifyNoMoreInteractions(expiry);
    }

    @Test
    void stopsImmediatelyWhenNoOfferIsOverdue() {
        when(expiry.expireBatch(NOW, 50)).thenReturn(0);

        worker(50, 10).expireOverdueOffers();

        verify(expiry, times(1)).expireBatch(NOW, 50);
    }

    @Test
    void keepsDrainingWhileEveryBatchIsFull() {
        when(expiry.expireBatch(NOW, 2))
            .thenReturn(2)
            .thenReturn(2)
            .thenReturn(1);

        worker(2, 10).expireOverdueOffers();

        verify(expiry, times(3)).expireBatch(NOW, 2);
    }

    @Test
    void stopsAtTheBatchBudgetSoOneScanStaysBounded() {
        when(expiry.expireBatch(NOW, 2)).thenReturn(2);

        worker(2, 3).expireOverdueOffers();

        verify(expiry, times(3)).expireBatch(NOW, 2);
        verifyNoMoreInteractions(expiry);
    }

    @Test
    void readsTheClockOnceSoOneScanUsesOneCutoff() {
        List<Instant> cutoffs = new ArrayList<>();
        Clock advancing = new Clock() {
            private Instant current = NOW;

            @Override
            public ZoneOffset getZone() {
                return ZoneOffset.UTC;
            }

            @Override
            public Clock withZone(java.time.ZoneId zone) {
                return this;
            }

            @Override
            public Instant instant() {
                Instant instant = current;
                current = current.plusSeconds(60);
                return instant;
            }
        };
        when(expiry.expireBatch(any(), anyInt()))
            .thenReturn(2)
            .thenReturn(2)
            .thenReturn(0);

        new ApplicationOfferExpiryWorker(expiry, advancing, 2, 10)
            .expireOverdueOffers();

        ArgumentCaptor<Instant> captor =
            ArgumentCaptor.forClass(Instant.class);
        verify(expiry, times(3)).expireBatch(captor.capture(), eq(2));
        cutoffs.addAll(captor.getAllValues());
        assertThat(cutoffs).containsExactly(NOW, NOW, NOW);
    }

    @Test
    void abandonsTheScanWhenABatchFailsAndLeavesRetryToTheNextScan() {
        when(expiry.expireBatch(NOW, 2))
            .thenReturn(2)
            .thenThrow(new CannotAcquireLockException("lock timeout"));

        worker(2, 10).expireOverdueOffers();

        verify(expiry, times(2)).expireBatch(NOW, 2);
        verifyNoMoreInteractions(expiry);
    }

    @Test
    void clampsAnOutOfRangeBatchSizeIntoTheSupportedWindow() {
        when(expiry.expireBatch(NOW, 1)).thenReturn(0);

        worker(0, 10).expireOverdueOffers();

        verify(expiry).expireBatch(NOW, 1);

        ApplicationOfferExpiryService large =
            mock(ApplicationOfferExpiryService.class);
        when(large.expireBatch(NOW, 1000)).thenReturn(0);
        new ApplicationOfferExpiryWorker(large, CLOCK, 50_000, 10)
            .expireOverdueOffers();
        verify(large).expireBatch(NOW, 1000);
    }

    @Test
    void clampsAnOutOfRangeBatchBudgetIntoTheSupportedWindow() {
        when(expiry.expireBatch(NOW, 2)).thenReturn(2);

        worker(2, 0).expireOverdueOffers();

        verify(expiry, times(1)).expireBatch(NOW, 2);
        verifyNoMoreInteractions(expiry);
    }

    @Test
    void neverTouchesTheServiceOutsideAScan() {
        worker(50, 10);

        verify(expiry, never()).expireBatch(any(), anyInt());
    }

    private ApplicationOfferExpiryWorker worker(
        int batchSize,
        int maxBatchesPerScan
    ) {
        return new ApplicationOfferExpiryWorker(
            expiry,
            CLOCK,
            batchSize,
            maxBatchesPerScan
        );
    }
}
