package com.recruitment.interview.event;

import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.domain.InterviewStatus;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public final class InterviewEventV1 {
    public static final int SCHEMA_VERSION = 1;
    private static final long MAX_JSON_SAFE_INTEGER =
        9_007_199_254_740_991L;
    private static final DateTimeFormatter UTC_MILLIS =
        new DateTimeFormatterBuilder().appendInstant(3).toFormatter();

    public enum Action {
        SCHEDULED
    }

    private InterviewEventV1() {}

    public static Map<String, Object> scheduled(
        UUID eventId,
        InterviewEntity interview,
        Instant occurredAt
    ) {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(interview, "interview");
        Objects.requireNonNull(occurredAt, "occurredAt");
        if (eventId.version() != 4 || eventId.variant() != 2) {
            throw new IllegalArgumentException(
                "Interview event ID must be a canonical UUIDv4"
            );
        }
        if (interview.getStatus() != InterviewStatus.SCHEDULED) {
            throw new IllegalArgumentException(
                "SCHEDULED event requires a scheduled Interview"
            );
        }
        if (
            interview.getVersion() < 0 ||
            interview.getVersion() > MAX_JSON_SAFE_INTEGER
        ) {
            throw new IllegalArgumentException(
                "Interview aggregate version must be a non-negative JSON-safe integer"
            );
        }
        if (
            interview.getRoundNumber() < 1 ||
            interview.getRoundNumber() > 20 ||
            interview.getScheduleRevision() < 1
        ) {
            throw new IllegalArgumentException(
                "Interview round and schedule revision are invalid"
            );
        }
        if (
            !interview.getScheduledEndAt().isAfter(
                interview.getScheduledStartAt()
            )
        ) {
            throw new IllegalArgumentException(
                "Interview schedule interval is invalid"
            );
        }

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("schema_version", SCHEMA_VERSION);
        event.put("event_id", eventId);
        event.put("action", Action.SCHEDULED);
        event.put("interview_id", interview.getId());
        event.put("application_id", interview.getApplicationId());
        event.put("candidate_id", interview.getCandidateId());
        event.put("interviewer_id", interview.getInterviewerId());
        event.put("actor_id", interview.getScheduledBy());
        event.put("round_number", interview.getRoundNumber());
        event.put("schedule_revision", interview.getScheduleRevision());
        event.put(
            "scheduled_start_at",
            UTC_MILLIS.format(interview.getScheduledStartAt())
        );
        event.put(
            "scheduled_end_at",
            UTC_MILLIS.format(interview.getScheduledEndAt())
        );
        event.put("status", InterviewStatus.SCHEDULED);
        event.put("aggregate_version", interview.getVersion());
        event.put("occurred_at", UTC_MILLIS.format(occurredAt));
        return event;
    }
}
