package com.recruitment.interview.event;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.interview.config.InterviewEventProperties;
import com.recruitment.interview.domain.InterviewEntity;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class InterviewEventOutboxWriter {
    private final InterviewOutboxStore outbox;
    private final InterviewEventProperties properties;
    private final ObjectMapper objectMapper;

    public InterviewEventOutboxWriter(
        InterviewOutboxStore outbox,
        InterviewEventProperties properties,
        ObjectMapper objectMapper
    ) {
        this.outbox = outbox;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public UUID appendScheduled(InterviewEntity interview) {
        UUID eventId = UUID.randomUUID();
        Instant occurredAt = interview.getCreatedAt();
        Map<String, Object> event = InterviewEventV1.scheduled(
            eventId,
            interview,
            occurredAt
        );
        try {
            outbox.append(
                eventId,
                interview,
                properties.getTopic(),
                objectMapper.writeValueAsString(event),
                occurredAt
            );
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                "Could not serialize interview-events v1",
                exception
            );
        }
        return eventId;
    }
}
