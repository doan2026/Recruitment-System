package com.recruitment.application.offer;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
class ApplicationOfferMigrationV9IT {
    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("recruitment")
            .withUsername("recruitment")
            .withPassword("recruitment");

    @Test
    void v9BackfillsLegacyTerminalApplicationsWithoutTouchingOpenOffers() {
        migrateTo(MigrationVersion.fromVersion("8"));
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
            POSTGRES.getJdbcUrl(),
            POSTGRES.getUsername(),
            POSTGRES.getPassword()
        ));
        UUID rejectedApplication = UUID.randomUUID();
        UUID withdrawnApplication = UUID.randomUUID();
        UUID openApplication = UUID.randomUUID();
        UUID rejectedOffer = insertLegacyState(
            jdbc,
            rejectedApplication,
            "REJECTED",
            Instant.parse("2026-08-28T08:00:00Z")
        );
        UUID withdrawnOffer = insertLegacyState(
            jdbc,
            withdrawnApplication,
            "WITHDRAWN",
            Instant.parse("2026-08-28T09:00:00Z")
        );
        UUID openOffer = insertLegacyState(
            jdbc,
            openApplication,
            "OFFER",
            Instant.parse("2026-08-28T10:00:00Z")
        );

        migrateTo(MigrationVersion.fromVersion("9"));

        assertCancelled(jdbc, rejectedOffer);
        assertCancelled(jdbc, withdrawnOffer);
        Map<String, Object> open = offerState(jdbc, openOffer);
        assertThat(open)
            .containsEntry("status", "SENT")
            .containsEntry("responded_at", null)
            .containsEntry("response_note", null)
            .containsEntry("version", 0L);
        List<String> versions = jdbc.queryForList(
            """
            SELECT version
            FROM application.flyway_schema_history
            WHERE success AND version IS NOT NULL
            ORDER BY installed_rank
            """,
            String.class
        );
        assertThat(versions)
            .containsExactly("1", "2", "3", "4", "5", "6", "7", "8", "9");
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.application_history",
            Long.class
        )).isZero();
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.application_event_outbox",
            Long.class
        )).isZero();
    }

    private void migrateTo(MigrationVersion target) {
        var configuration = Flyway.configure()
            .dataSource(
                POSTGRES.getJdbcUrl(),
                POSTGRES.getUsername(),
                POSTGRES.getPassword()
            )
            .createSchemas(true)
            .defaultSchema("application")
            .schemas("application");
        if (target != null) {
            configuration.target(target);
        }
        configuration.load().migrate();
    }

    private UUID insertLegacyState(
        JdbcTemplate jdbc,
        UUID applicationId,
        String applicationStatus,
        Instant updatedAt
    ) {
        UUID offerId = UUID.randomUUID();
        Instant sentAt = updatedAt.minusSeconds(300);
        jdbc.update(
            """
            INSERT INTO application.applications (
                id, job_id, company_id, candidate_id, recruiter_id, cv_id,
                job_title, status, source, applied_at, updated_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SEARCH', ?, ?, 1)
            """,
            applicationId,
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Backend Engineer",
            applicationStatus,
            Timestamp.from(updatedAt.minusSeconds(3600)),
            Timestamp.from(updatedAt)
        );
        jdbc.update(
            """
            INSERT INTO application.offers (
                id, application_id, sent_by, salary, start_date, position,
                status, sent_at, expires_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, 'SENT', ?, ?, 0)
            """,
            offerId,
            applicationId,
            UUID.randomUUID(),
            new BigDecimal("25000000.00"),
            LocalDate.of(2026, 9, 15),
            "Backend Engineer",
            Timestamp.from(sentAt),
            Timestamp.from(updatedAt.plusSeconds(86400))
        );
        return offerId;
    }

    private void assertCancelled(JdbcTemplate jdbc, UUID offerId) {
        Map<String, Object> state = offerState(jdbc, offerId);
        assertThat(state)
            .containsEntry("status", "CANCELLED")
            .containsEntry("response_note", null)
            .containsEntry("version", 1L);
        assertThat(state.get("responded_at")).isNotNull();
    }

    private Map<String, Object> offerState(
        JdbcTemplate jdbc,
        UUID offerId
    ) {
        return jdbc.queryForMap(
            """
            SELECT status, responded_at, response_note, version
            FROM application.offers
            WHERE id = ?
            """,
            offerId
        );
    }
}
