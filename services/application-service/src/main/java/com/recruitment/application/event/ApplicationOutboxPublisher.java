package com.recruitment.application.event;

import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class ApplicationOutboxPublisher {
    private static final Logger LOGGER =
        LoggerFactory.getLogger(ApplicationOutboxPublisher.class);
    private final ApplicationEventOutboxRepository outbox;
    private final KafkaTemplate<String, String> kafka;
    private final Clock clock;

    @Autowired
    public ApplicationOutboxPublisher(
        ApplicationEventOutboxRepository outbox,
        KafkaTemplate<String, String> kafka
    ) {
        this(outbox, kafka, Clock.systemUTC());
    }

    ApplicationOutboxPublisher(
        ApplicationEventOutboxRepository outbox,
        KafkaTemplate<String, String> kafka,
        Clock clock
    ) {
        this.outbox = outbox;
        this.kafka = kafka;
        this.clock = clock;
    }

    @Scheduled(
        fixedDelayString = "${application-events.publish-delay-ms}",
        initialDelayString =
            "${application-events.publish-initial-delay-ms}"
    )
    @Transactional
    public void publishPending() {
        Instant now = clock.instant();
        List<ApplicationEventOutboxEntity> events =
            outbox.lockNextPublishableBatch(now);
        for (ApplicationEventOutboxEntity event : events) {
            try {
                kafka.send(
                    event.getTopic(),
                    event.getEventKey().toString(),
                    event.getPayload()
                ).get(5, TimeUnit.SECONDS);
                event.markPublished(clock.instant());
            } catch (Exception exception) {
                Duration backoff = backoff(event.getAttempts());
                event.markFailed(
                    rootMessage(exception),
                    clock.instant().plus(backoff)
                );
                LOGGER.warn(
                    "Could not publish application event {} (attempt {}): {}",
                    event.getId(),
                    event.getAttempts(),
                    rootMessage(exception)
                );
            }
        }
    }

    private Duration backoff(int attempts) {
        long seconds = Math.min(900, 1L << Math.min(attempts, 9));
        return Duration.ofSeconds(seconds);
    }

    private String rootMessage(Exception exception) {
        Throwable current = exception;
        while (current.getCause() != null) current = current.getCause();
        return current.getMessage() == null
            ? current.getClass().getSimpleName()
            : current.getMessage();
    }
}
