package com.recruitment.application.offer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
class ApplicationOfferMigrationV10IT {
    // Each test drives Flyway from a different starting version, so every
    // method gets its own database instead of sharing migrated state.
    @Container
    private final PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("recruitment")
            .withUsername("recruitment")
            .withPassword("recruitment");

    @Test
    void v10ExpiresLapsedOffersAndLeavesEveryOtherOfferUntouched() {
        migrateTo(MigrationVersion.fromVersion("9"));
        JdbcTemplate jdbc = jdbc();
        // TIMESTAMPTZ(3) keeps milliseconds, so the fixture stays at that
        // precision and the backfilled responded_at compares exactly.
        Instant reference = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        Instant longLapsed = reference.minusSeconds(7 * 86_400);
        Instant justLapsed = reference.minusSeconds(5);
        Instant stillOpen = reference.plusSeconds(7 * 86_400);
        UUID longLapsedOffer = insertOpenOffer(jdbc, longLapsed);
        UUID justLapsedOffer = insertOpenOffer(jdbc, justLapsed);
        UUID openOffer = insertOpenOffer(jdbc, stillOpen);
        UUID acceptedOffer = insertRespondedOffer(
            jdbc,
            "ACCEPTED",
            longLapsed,
            null
        );
        UUID declinedOffer = insertRespondedOffer(
            jdbc,
            "DECLINED",
            longLapsed,
            "Accepted another role"
        );
        UUID cancelledOffer = insertRespondedOffer(
            jdbc,
            "CANCELLED",
            longLapsed,
            null
        );

        migrateTo(MigrationVersion.fromVersion("10"));

        assertExpired(jdbc, longLapsedOffer, longLapsed);
        assertExpired(jdbc, justLapsedOffer, justLapsed);
        assertThat(offerState(jdbc, openOffer))
            .containsEntry("status", "SENT")
            .containsEntry("responded_at", null)
            .containsEntry("response_note", null)
            .containsEntry("version", 0L);
        assertThat(offerState(jdbc, acceptedOffer))
            .containsEntry("status", "ACCEPTED")
            .containsEntry("version", 1L);
        assertThat(offerState(jdbc, declinedOffer))
            .containsEntry("status", "DECLINED")
            .containsEntry("version", 1L);
        assertThat(offerState(jdbc, cancelledOffer))
            .containsEntry("status", "CANCELLED")
            .containsEntry("version", 1L);
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.application_history",
            Long.class
        )).isZero();
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.application_event_outbox",
            Long.class
        )).isZero();
        List<String> versions = jdbc.queryForList(
            """
            SELECT version
            FROM application.flyway_schema_history
            WHERE success AND version IS NOT NULL
            ORDER BY installed_rank
            """,
            String.class
        );
        assertThat(versions).containsExactly(
            "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"
        );
    }

    @Test
    void v10KeepsTheExpiredRowCoherentAndTheStatusDomainClosed() {
        migrateTo(null);
        JdbcTemplate jdbc = jdbc();
        UUID offerId = insertOpenOffer(jdbc, Instant.now().plusSeconds(3600));

        assertThatThrownBy(() -> jdbc.update(
            """
            UPDATE application.offers
            SET status = 'EXPIRED', responded_at = NULL
            WHERE id = ?
            """,
            offerId
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(
            """
            UPDATE application.offers
            SET status = 'EXPIRED',
                responded_at = expires_at,
                response_note = 'lapsed'
            WHERE id = ?
            """,
            offerId
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(
            "UPDATE application.offers SET status = 'LAPSED' WHERE id = ?",
            offerId
        )).isInstanceOf(DataIntegrityViolationException.class);

        assertThat(jdbc.update(
            """
            UPDATE application.offers
            SET status = 'EXPIRED', responded_at = expires_at
            WHERE id = ?
            """,
            offerId
        )).isEqualTo(1);
        assertThat(offerState(jdbc, offerId))
            .containsEntry("status", "EXPIRED")
            .containsEntry("response_note", null);
        String pendingExpiryIndex = jdbc.queryForObject(
            """
            SELECT indexdef
            FROM pg_indexes
            WHERE schemaname = 'application'
              AND tablename = 'offers'
              AND indexname = 'offers_pending_expiry_idx'
            """,
            String.class
        );
        assertThat(pendingExpiryIndex)
            .contains("expires_at")
            .contains("'SENT'");
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(
            postgres.getJdbcUrl(),
            postgres.getUsername(),
            postgres.getPassword()
        ));
    }

    private void migrateTo(MigrationVersion target) {
        var configuration = Flyway.configure()
            .dataSource(
                postgres.getJdbcUrl(),
                postgres.getUsername(),
                postgres.getPassword()
            )
            .createSchemas(true)
            .defaultSchema("application")
            .schemas("application");
        if (target != null) {
            configuration.target(target);
        }
        configuration.load().migrate();
    }

    private UUID insertOpenOffer(JdbcTemplate jdbc, Instant expiresAt) {
        return insertOffer(jdbc, "SENT", expiresAt, null, null, 0L);
    }

    private UUID insertRespondedOffer(
        JdbcTemplate jdbc,
        String status,
        Instant expiresAt,
        String responseNote
    ) {
        return insertOffer(
            jdbc,
            status,
            expiresAt,
            expiresAt.minusSeconds(60),
            responseNote,
            1L
        );
    }

    private UUID insertOffer(
        JdbcTemplate jdbc,
        String status,
        Instant expiresAt,
        Instant respondedAt,
        String responseNote,
        long version
    ) {
        UUID applicationId = UUID.randomUUID();
        UUID offerId = UUID.randomUUID();
        Instant sentAt = expiresAt.minusSeconds(30 * 86_400);
        jdbc.update(
            """
            INSERT INTO application.applications (
                id, job_id, company_id, candidate_id, recruiter_id, cv_id,
                job_title, status, source, applied_at, updated_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OFFER', 'SEARCH', ?, ?, 1)
            """,
            applicationId,
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Backend Engineer",
            Timestamp.from(sentAt),
            Timestamp.from(sentAt)
        );
        jdbc.update(
            """
            INSERT INTO application.offers (
                id, application_id, sent_by, salary, start_date, position,
                status, sent_at, expires_at, responded_at, response_note,
                version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            offerId,
            applicationId,
            UUID.randomUUID(),
            new BigDecimal("25000000.00"),
            LocalDate.of(2026, 12, 15),
            "Backend Engineer",
            status,
            Timestamp.from(sentAt),
            Timestamp.from(expiresAt),
            respondedAt == null ? null : Timestamp.from(respondedAt),
            responseNote,
            version
        );
        return offerId;
    }

    private void assertExpired(
        JdbcTemplate jdbc,
        UUID offerId,
        Instant expiresAt
    ) {
        Map<String, Object> state = offerState(jdbc, offerId);
        assertThat(state)
            .containsEntry("status", "EXPIRED")
            .containsEntry("response_note", null)
            .containsEntry("version", 1L);
        assertThat(((Timestamp) state.get("responded_at")).toInstant())
            .isEqualTo(expiresAt);
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
