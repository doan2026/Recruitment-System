package com.recruitment.interview.event;

import com.recruitment.interview.domain.InterviewEntity;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class InterviewOutboxStore {
    private final NamedParameterJdbcTemplate jdbc;

    public InterviewOutboxStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void append(
        UUID eventId,
        InterviewEntity interview,
        String topic,
        String payload,
        Instant occurredAt
    ) {
        jdbc.update(
            """
            INSERT INTO interview.interview_event_outbox (
                event_id, interview_id, aggregate_version, action,
                topic, event_key, payload, next_attempt_at, created_at
            ) VALUES (
                :eventId, :interviewId, :aggregateVersion, 'SCHEDULED',
                :topic, :eventKey, CAST(:payload AS jsonb),
                :occurredAt, :occurredAt
            )
            """,
            new MapSqlParameterSource()
                .addValue("eventId", eventId)
                .addValue("interviewId", interview.getId())
                .addValue("aggregateVersion", interview.getVersion())
                .addValue("topic", topic)
                .addValue("eventKey", interview.getId())
                .addValue("payload", payload)
                .addValue("occurredAt", Timestamp.from(occurredAt))
        );
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<InterviewOutboxRecord> claimNext(
        String workerId,
        Instant now,
        Instant leaseExpiresAt
    ) {
        List<InterviewOutboxRecord> claimed = jdbc.query(
            """
            WITH candidate AS (
                SELECT pending.event_id
                FROM interview.interview_event_outbox AS pending
                WHERE pending.published_at IS NULL
                  AND pending.next_attempt_at <= :now
                  AND (
                    pending.lease_expires_at IS NULL
                    OR pending.lease_expires_at < :now
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM interview.interview_event_outbox AS earlier
                    WHERE earlier.interview_id = pending.interview_id
                      AND earlier.aggregate_version < pending.aggregate_version
                      AND earlier.published_at IS NULL
                  )
                ORDER BY pending.stream_position
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE interview.interview_event_outbox AS claimed
            SET lease_owner = :workerId,
                lease_expires_at = :leaseExpiresAt,
                lease_fence = claimed.lease_fence + 1,
                attempts = claimed.attempts + 1
            FROM candidate
            WHERE claimed.event_id = candidate.event_id
            RETURNING claimed.event_id, claimed.event_key,
                      claimed.topic, claimed.payload::text,
                      claimed.attempts, claimed.lease_fence
            """,
            new MapSqlParameterSource()
                .addValue("workerId", workerId)
                .addValue("now", Timestamp.from(now))
                .addValue(
                    "leaseExpiresAt",
                    Timestamp.from(leaseExpiresAt)
                ),
            InterviewOutboxStore::mapRecord
        );
        return claimed.stream().findFirst();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean markPublished(
        InterviewOutboxRecord event,
        String workerId,
        Instant publishedAt
    ) {
        return jdbc.update(
            """
            UPDATE interview.interview_event_outbox
            SET published_at = :publishedAt,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = NULL
            WHERE event_id = :eventId
              AND lease_owner = :workerId
              AND lease_fence = :leaseFence
              AND published_at IS NULL
            """,
            parameters(event, workerId)
                .addValue("publishedAt", Timestamp.from(publishedAt))
        ) == 1;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean releaseForRetry(
        InterviewOutboxRecord event,
        String workerId,
        Instant retryAt,
        String errorCode
    ) {
        return jdbc.update(
            """
            UPDATE interview.interview_event_outbox
            SET next_attempt_at = :retryAt,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = :errorCode
            WHERE event_id = :eventId
              AND lease_owner = :workerId
              AND lease_fence = :leaseFence
              AND published_at IS NULL
            """,
            parameters(event, workerId)
                .addValue("retryAt", Timestamp.from(retryAt))
                .addValue("errorCode", errorCode)
        ) == 1;
    }

    public BacklogSnapshot backlog() {
        return jdbc.queryForObject(
            """
            SELECT COUNT(*) AS pending_count,
                   MIN(created_at) AS oldest_created_at,
                   COALESCE(MAX(attempts), 0) AS max_attempts
            FROM interview.interview_event_outbox
            WHERE published_at IS NULL
            """,
            Map.of(),
            (resultSet, rowNumber) -> new BacklogSnapshot(
                resultSet.getLong("pending_count"),
                resultSet.getTimestamp("oldest_created_at") == null
                    ? null
                    : resultSet
                        .getTimestamp("oldest_created_at")
                        .toInstant(),
                resultSet.getInt("max_attempts")
            )
        );
    }

    private static MapSqlParameterSource parameters(
        InterviewOutboxRecord event,
        String workerId
    ) {
        return new MapSqlParameterSource()
            .addValue("eventId", event.eventId())
            .addValue("workerId", workerId)
            .addValue("leaseFence", event.leaseFence());
    }

    private static InterviewOutboxRecord mapRecord(
        ResultSet resultSet,
        int rowNumber
    ) throws SQLException {
        return new InterviewOutboxRecord(
            resultSet.getObject("event_id", UUID.class),
            resultSet.getObject("event_key", UUID.class),
            resultSet.getString("topic"),
            resultSet.getString("payload"),
            resultSet.getInt("attempts"),
            resultSet.getLong("lease_fence")
        );
    }

    public record BacklogSnapshot(
        long pendingCount,
        Instant oldestCreatedAt,
        int maxAttempts
    ) {}
}
