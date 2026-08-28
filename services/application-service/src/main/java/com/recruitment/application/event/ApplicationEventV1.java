package com.recruitment.application.event;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Canonical common fields for the {@code application-events} v1 contract.
 *
 * <p>The aggregate version always identifies the resulting Application state,
 * not the state that was loaded before the command. Event-specific fields,
 * such as the Offer identifiers, are appended by the producer after this
 * method returns.</p>
 */
public final class ApplicationEventV1 {
    public static final int SCHEMA_VERSION = 1;
    private static final long MAX_JSON_SAFE_INTEGER = 9_007_199_254_740_991L;

    public enum Action {
        STATUS_CHANGED,
        OFFER_SENT
    }

    private ApplicationEventV1() {}

    public static Map<String, Object> base(
        UUID eventId,
        Action action,
        ApplicationEntity application,
        UUID actorId,
        ApplicationStatus fromStatus,
        ApplicationStatus toStatus,
        long aggregateVersion,
        Instant occurredAt
    ) {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(application, "application");
        Objects.requireNonNull(toStatus, "toStatus");
        Objects.requireNonNull(occurredAt, "occurredAt");
        if (
            aggregateVersion < 0 ||
            aggregateVersion > MAX_JSON_SAFE_INTEGER
        ) {
            throw new IllegalArgumentException(
                "aggregateVersion must be a non-negative JSON-safe integer"
            );
        }
        String jobTitle = application.getJobTitle();
        if (
            jobTitle == null ||
            jobTitle.isEmpty() ||
            jobTitle.length() > 200 ||
            jobTitle.codePoints().anyMatch(
                character ->
                    (character >= 0 && character <= 0x1F) ||
                    character == 0x7F
            )
        ) {
            throw new IllegalArgumentException(
                "jobTitle must satisfy the application-events v1 contract"
            );
        }

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("schema_version", SCHEMA_VERSION);
        event.put("event_id", eventId);
        event.put("action", action);
        event.put("application_id", application.getId());
        event.put("job_id", application.getJobId());
        event.put("job_title", jobTitle);
        event.put("candidate_id", application.getCandidateId());
        event.put("recruiter_id", application.getRecruiterId());
        event.put("actor_id", actorId);
        event.put("from_status", fromStatus);
        event.put("to_status", toStatus);
        event.put("aggregate_version", aggregateVersion);
        event.put("occurred_at", occurredAt);
        return event;
    }
}
