package com.recruitment.interview.health;

import com.recruitment.interview.config.InterviewEventProperties;
import com.recruitment.interview.event.InterviewOutboxStore;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("interviewEventOutbox")
public class InterviewEventOutboxHealthIndicator
    implements HealthIndicator {
    private final InterviewOutboxStore outbox;
    private final InterviewEventProperties properties;
    private final Clock clock;

    public InterviewEventOutboxHealthIndicator(
        InterviewOutboxStore outbox,
        InterviewEventProperties properties,
        Clock clock
    ) {
        this.outbox = outbox;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public Health health() {
        if (!properties.isPublisherEnabled()) {
            return Health.up()
                .withDetail("publisher", "PAUSED")
                .build();
        }
        try {
            InterviewOutboxStore.BacklogSnapshot backlog = outbox.backlog();
            Instant oldest = backlog.oldestCreatedAt();
            long ageMs = oldest == null
                ? 0
                : Math.max(
                    0,
                    Duration.between(oldest, clock.instant()).toMillis()
                );
            Health.Builder health = ageMs > properties.getBacklogMaxAgeMs()
                ? Health.outOfService()
                : Health.up();
            return health
                .withDetail("publisher", "ENABLED")
                .withDetail("pending", backlog.pendingCount())
                .withDetail("oldestAgeMs", ageMs)
                .withDetail("maxAttempts", backlog.maxAttempts())
                .build();
        } catch (RuntimeException exception) {
            return Health.down()
                .withDetail("reason", "OUTBOX_QUERY_FAILED")
                .build();
        }
    }
}
