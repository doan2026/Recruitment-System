package com.recruitment.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "application_event_outbox")
public class ApplicationEventOutboxEntity {
    @Id
    private UUID id;

    @Column(name = "aggregate_id", nullable = false)
    private UUID aggregateId;

    @Column(name = "event_key", nullable = false)
    private UUID eventKey;

    @Column(nullable = false, length = 200)
    private String topic;

    @Column(nullable = false, columnDefinition = "text")
    private String payload;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "last_error", length = 2000)
    private String lastError;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected ApplicationEventOutboxEntity() {}

    public static ApplicationEventOutboxEntity pending(
        UUID eventId,
        UUID applicationId,
        String topic,
        String payload,
        Instant now
    ) {
        ApplicationEventOutboxEntity outbox =
            new ApplicationEventOutboxEntity();
        outbox.id = eventId;
        outbox.aggregateId = applicationId;
        outbox.eventKey = applicationId;
        outbox.topic = topic;
        outbox.payload = payload;
        outbox.nextAttemptAt = now;
        outbox.createdAt = now;
        return outbox;
    }

    public void markPublished(Instant now) {
        publishedAt = now;
        lastError = null;
    }

    public void markFailed(String message, Instant retryAt) {
        attempts++;
        lastError = message == null
            ? "Unknown Kafka publish error"
            : message.substring(0, Math.min(message.length(), 2000));
        nextAttemptAt = retryAt;
    }

    public UUID getId() { return id; }
    public UUID getEventKey() { return eventKey; }
    public String getTopic() { return topic; }
    public String getPayload() { return payload; }
    public int getAttempts() { return attempts; }
}
