package com.recruitment.application.pipeline;

import com.recruitment.application.domain.ApplicationStatus;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class ApplicationHistoryWriter {
    private final JdbcTemplate jdbc;

    public ApplicationHistoryWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void append(
        UUID applicationId,
        ApplicationStatus fromStatus,
        ApplicationStatus toStatus,
        UUID changedBy,
        String note,
        Instant changedAt
    ) {
        jdbc.update(
            """
            INSERT INTO application.application_history (
                id, application_id, from_status, to_status,
                changed_by, note, changed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            UUID.randomUUID(),
            applicationId,
            fromStatus.name(),
            toStatus.name(),
            changedBy,
            note,
            Timestamp.from(changedAt)
        );
    }
}
