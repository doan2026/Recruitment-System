package com.recruitment.interview.event;

import com.recruitment.interview.config.InterviewEventProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class InterviewOutboxPublisher {
    private static final Logger LOGGER =
        LoggerFactory.getLogger(InterviewOutboxPublisher.class);

    private final InterviewOutboxStore outbox;
    private final KafkaTemplate<String, String> kafka;
    private final InterviewEventProperties properties;
    private final Clock clock;
    private final String workerId = UUID.randomUUID().toString();
    private final AtomicBoolean draining = new AtomicBoolean();

    public InterviewOutboxPublisher(
        InterviewOutboxStore outbox,
        KafkaTemplate<String, String> kafka,
        InterviewEventProperties properties,
        Clock clock
    ) {
        this.outbox = outbox;
        this.kafka = kafka;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(
        fixedDelayString = "${interview-events.poll-delay-ms:5000}",
        initialDelayString =
            "${interview-events.publish-initial-delay-ms:5000}"
    )
    public int publishPending() {
        if (
            !properties.isPublisherEnabled() ||
            !draining.compareAndSet(false, true)
        ) {
            return 0;
        }
        int published = 0;
        try {
            for (int index = 0; index < properties.getBatchSize(); index++) {
                Instant now = clock.instant();
                InterviewOutboxRecord event = outbox.claimNext(
                    workerId,
                    now,
                    now.plusMillis(properties.getLeaseMs())
                ).orElse(null);
                if (event == null) break;
                if (publish(event)) published++;
                if (Thread.currentThread().isInterrupted()) break;
            }
            return published;
        } finally {
            draining.set(false);
        }
    }

    private boolean publish(InterviewOutboxRecord event) {
        try {
            kafka.send(
                event.topic(),
                event.eventKey().toString(),
                event.payload()
            ).get(properties.getPublishTimeoutMs(), TimeUnit.MILLISECONDS);
            if (!outbox.markPublished(event, workerId, clock.instant())) {
                LOGGER.warn(
                    "Interview event {} was acknowledged after its outbox lease was lost",
                    event.eventId()
                );
                return false;
            }
            return true;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            defer(event, exception);
            return false;
        } catch (Exception exception) {
            defer(event, exception);
            return false;
        }
    }

    private void defer(
        InterviewOutboxRecord event,
        Exception exception
    ) {
        Duration delay = retryDelay(event.attempts());
        outbox.releaseForRetry(
            event,
            workerId,
            clock.instant().plus(delay),
            safeErrorCode(exception)
        );
        LOGGER.warn(
            "Interview event {} publish deferred ({})",
            event.eventId(),
            safeErrorCode(exception)
        );
    }

    private Duration retryDelay(int attempts) {
        int exponent = Math.max(0, Math.min(attempts - 1, 20));
        long multiplier = 1L << exponent;
        long base = properties.getRetryBaseMs();
        long delay = multiplier > properties.getRetryMaxMs() / base
            ? properties.getRetryMaxMs()
            : Math.min(base * multiplier, properties.getRetryMaxMs());
        return Duration.ofMillis(delay);
    }

    private String safeErrorCode(Exception exception) {
        Throwable current = exception;
        while (current.getCause() != null) current = current.getCause();
        String name = current.getClass().getSimpleName();
        if (name == null || name.isBlank()) name = "UnknownError";
        return name.substring(0, Math.min(name.length(), 96));
    }
}
