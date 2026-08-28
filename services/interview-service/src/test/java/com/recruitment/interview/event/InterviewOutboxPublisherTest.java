package com.recruitment.interview.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.interview.config.InterviewEventProperties;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;

@ExtendWith(MockitoExtension.class)
class InterviewOutboxPublisherTest {
    private static final Instant NOW =
        Instant.parse("2026-08-28T14:20:00Z");

    @Mock
    private InterviewOutboxStore outbox;
    @Mock
    private KafkaTemplate<String, String> kafka;

    private InterviewEventProperties properties;
    private InterviewOutboxPublisher publisher;

    @BeforeEach
    void setUp() {
        properties = new InterviewEventProperties();
        properties.setBatchSize(2);
        publisher = new InterviewOutboxPublisher(
            outbox,
            kafka,
            properties,
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void publishesClaimedEventAndMarksMatchingLease() {
        InterviewOutboxRecord event = event(1);
        when(outbox.claimNext(anyString(), any(), any()))
            .thenReturn(Optional.of(event), Optional.empty());
        CompletableFuture<SendResult<String, String>> success =
            CompletableFuture.completedFuture(null);
        when(kafka.send(event.topic(), event.eventKey().toString(),
            event.payload())).thenReturn(success);
        when(outbox.markPublished(eq(event), anyString(), eq(NOW)))
            .thenReturn(true);

        assertThat(publisher.publishPending()).isEqualTo(1);
        verify(outbox).markPublished(eq(event), anyString(), eq(NOW));
        verify(outbox, never()).releaseForRetry(
            any(), anyString(), any(), anyString()
        );
    }

    @Test
    void releasesFailedSendWithBoundedBackoffAndSafeErrorCode() {
        InterviewOutboxRecord event = event(1);
        when(outbox.claimNext(anyString(), any(), any()))
            .thenReturn(Optional.of(event), Optional.empty());
        CompletableFuture<SendResult<String, String>> failed =
            CompletableFuture.failedFuture(
                new IllegalStateException("secret broker detail")
            );
        when(kafka.send(anyString(), anyString(), anyString()))
            .thenReturn(failed);
        when(outbox.releaseForRetry(
            eq(event),
            anyString(),
            eq(NOW.plusSeconds(1)),
            eq("IllegalStateException")
        )).thenReturn(true);

        assertThat(publisher.publishPending()).isZero();
        verify(outbox).releaseForRetry(
            eq(event),
            anyString(),
            eq(NOW.plusSeconds(1)),
            eq("IllegalStateException")
        );
        verify(outbox, never()).markPublished(any(), anyString(), any());
    }

    @Test
    void pausedPublisherDoesNotClaimOrTouchKafka() {
        properties.setPublisherEnabled(false);

        assertThat(publisher.publishPending()).isZero();
        verify(outbox, never()).claimNext(anyString(), any(), any());
        verify(kafka, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void interruptedPublishRestoresFlagAndStopsDraining() {
        InterviewOutboxRecord event = event(1);
        when(outbox.claimNext(anyString(), any(), any()))
            .thenReturn(Optional.of(event));
        when(kafka.send(anyString(), anyString(), anyString()))
            .thenReturn(new CompletableFuture<>());
        when(outbox.releaseForRetry(
            eq(event),
            anyString(),
            eq(NOW.plusSeconds(1)),
            eq("InterruptedException")
        )).thenReturn(true);

        try {
            Thread.currentThread().interrupt();
            assertThat(publisher.publishPending()).isZero();
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }

        verify(outbox, times(1)).claimNext(anyString(), any(), any());
    }

    private InterviewOutboxRecord event(int attempts) {
        return new InterviewOutboxRecord(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "interview-events",
            "{\"schema_version\":1}",
            attempts,
            1
        );
    }
}
