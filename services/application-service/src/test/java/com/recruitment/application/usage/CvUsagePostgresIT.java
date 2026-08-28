package com.recruitment.application.usage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.repository.ApplicationRepository;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@DataJpaTest(properties = {
    "spring.jpa.hibernate.ddl-auto=validate",
    "spring.jpa.properties.hibernate.default_schema=application",
    "spring.flyway.enabled=true",
    "spring.flyway.create-schemas=true",
    "spring.flyway.default-schema=application",
    "spring.flyway.schemas=application"
})
@AutoConfigureTestDatabase(
    replace = AutoConfigureTestDatabase.Replace.NONE
)
@Import(CvUsageLookupService.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class CvUsagePostgresIT {
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000001"
    );
    private static final UUID CV_ID = UUID.fromString(
        "20000000-0000-4000-8000-000000000001"
    );
    private static final Instant FIRST_APPLIED_AT = Instant.parse(
        "2026-08-27T08:00:00Z"
    );

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("recruitment")
            .withUsername("recruitment")
            .withPassword("recruitment");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private ApplicationRepository applications;

    @Autowired
    private CvUsageLookupService usages;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @BeforeEach
    void cleanDatabase() {
        jdbc.execute(
            "TRUNCATE TABLE application.applications, " +
                "application.application_cv_usage, " +
                "application.cv_submission_gates CASCADE"
        );
    }

    @Test
    void insertTriggerRecordsFirstUseAndCountsEveryApplication() {
        save(CANDIDATE_ID, CV_ID, FIRST_APPLIED_AT);
        save(
            CANDIDATE_ID,
            CV_ID,
            FIRST_APPLIED_AT.plusSeconds(3600)
        );

        CvUsageLookupResponse result = usages.lookup(
            new CvUsageLookupRequest(CANDIDATE_ID, CV_ID)
        );

        assertThat(result.used()).isTrue();
        assertThat(result.firstUsedAt()).isEqualTo(FIRST_APPLIED_AT);
        assertThat(result.applicationCount()).isEqualTo(2);
    }

    @Test
    void unknownCvReturnsAnEchoedUnusedResult() {
        UUID unknownCv = UUID.randomUUID();

        CvUsageLookupResponse result = usages.lookup(
            new CvUsageLookupRequest(CANDIDATE_ID, unknownCv)
        );

        assertThat(result.candidateId()).isEqualTo(CANDIDATE_ID);
        assertThat(result.cvId()).isEqualTo(unknownCv);
        assertThat(result.used()).isFalse();
        assertThat(result.firstUsedAt()).isNull();
        assertThat(result.applicationCount()).isZero();
    }

    @Test
    void rolledBackApplicationDoesNotLeaveUsageEvidence() {
        TransactionTemplate transaction = new TransactionTemplate(
            transactionManager
        );

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            applications.saveAndFlush(application(
                CANDIDATE_ID,
                CV_ID,
                FIRST_APPLIED_AT
            ));
            throw new IllegalStateException("force rollback");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.application_cv_usage " +
                "WHERE cv_id = ?",
            Long.class,
            CV_ID
        )).isZero();
    }

    @Test
    void deletingApplicationRetainsUsageEvidence() {
        ApplicationEntity application = save(
            CANDIDATE_ID,
            CV_ID,
            FIRST_APPLIED_AT
        );

        applications.deleteById(application.getId());

        assertThat(applications.findById(application.getId())).isEmpty();
        CvUsageLookupResponse usage = usages.lookup(
            new CvUsageLookupRequest(CANDIDATE_ID, CV_ID)
        );
        assertThat(usage.used()).isTrue();
        assertThat(usage.applicationCount()).isEqualTo(1);
    }

    @Test
    void sameCvCannotBeInsertedForAnotherCandidate() {
        save(CANDIDATE_ID, CV_ID, FIRST_APPLIED_AT);

        assertThatThrownBy(() -> save(
            UUID.randomUUID(),
            CV_ID,
            FIRST_APPLIED_AT.plusSeconds(60)
        )).isInstanceOf(DataIntegrityViolationException.class);

        CvUsageLookupResponse usage = usages.lookup(
            new CvUsageLookupRequest(CANDIDATE_ID, CV_ID)
        );
        assertThat(usage.applicationCount()).isEqualTo(1);
    }

    @Test
    void applicationIdentityAndCvReferenceAreImmutable() {
        ApplicationEntity application = save(
            CANDIDATE_ID,
            CV_ID,
            FIRST_APPLIED_AT
        );

        assertThatThrownBy(() -> jdbc.update(
            "UPDATE application.applications SET cv_id = ? WHERE id = ?",
            UUID.randomUUID(),
            application.getId()
        )).isInstanceOf(DataIntegrityViolationException.class);

        assertThatThrownBy(() -> jdbc.update(
            "UPDATE application.applications SET candidate_id = ? " +
                "WHERE id = ?",
            UUID.randomUUID(),
            application.getId()
        )).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void migrationBackfillsExistingApplicationsAndCreatesLookupIndex() {
        String schema = "application_cv_usage_backfill_test";
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        try {
            Flyway.configure()
                .dataSource(
                    POSTGRES.getJdbcUrl(),
                    POSTGRES.getUsername(),
                    POSTGRES.getPassword()
                )
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("5"))
                .load()
                .migrate();

            UUID firstApplication = UUID.randomUUID();
            insertLegacyApplication(
                schema,
                firstApplication,
                CANDIDATE_ID,
                CV_ID,
                FIRST_APPLIED_AT
            );
            insertLegacyApplication(
                schema,
                UUID.randomUUID(),
                CANDIDATE_ID,
                CV_ID,
                FIRST_APPLIED_AT.plusSeconds(7200)
            );

            Flyway.configure()
                .dataSource(
                    POSTGRES.getJdbcUrl(),
                    POSTGRES.getUsername(),
                    POSTGRES.getPassword()
                )
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration")
                .load()
                .migrate();

            Map<String, Object> usage = jdbc.queryForMap(
                "SELECT candidate_id, first_used_at, application_count " +
                    "FROM " + schema + ".application_cv_usage " +
                    "WHERE cv_id = ?",
                CV_ID
            );
            assertThat(usage.get("candidate_id"))
                .isEqualTo(CANDIDATE_ID);
            assertThat(((Timestamp) usage.get("first_used_at")).toInstant())
                .isEqualTo(FIRST_APPLIED_AT);
            assertThat(((Number) usage.get("application_count")).longValue())
                .isEqualTo(2);

            Map<String, Object> gate = jdbc.queryForMap(
                "SELECT candidate_id, state, deletion_request_id " +
                    "FROM " + schema + ".cv_submission_gates " +
                    "WHERE cv_id = ?",
                CV_ID
            );
            assertThat(gate.get("candidate_id")).isEqualTo(CANDIDATE_ID);
            assertThat(gate.get("state")).isEqualTo("OPEN");
            assertThat(gate.get("deletion_request_id")).isNull();

            UUID postMigrationCvId = UUID.randomUUID();
            insertLegacyApplication(
                schema,
                UUID.randomUUID(),
                CANDIDATE_ID,
                postMigrationCvId,
                FIRST_APPLIED_AT.plusSeconds(10800)
            );
            assertThat(jdbc.queryForObject(
                "SELECT application_count FROM " + schema +
                    ".application_cv_usage WHERE cv_id = ?",
                Long.class,
                postMigrationCvId
            )).isEqualTo(1L);
            assertThat(jdbc.queryForObject(
                "SELECT state FROM " + schema +
                    ".cv_submission_gates WHERE cv_id = ?",
                String.class,
                postMigrationCvId
            )).isEqualTo("OPEN");
            assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM application.application_cv_usage " +
                    "WHERE cv_id = ?",
                Long.class,
                postMigrationCvId
            )).isZero();

            Integer indexCount = jdbc.queryForObject(
                """
                SELECT COUNT(*)
                FROM pg_indexes
                WHERE schemaname = ?
                  AND indexname = 'applications_cv_candidate_applied_idx'
                """,
                Integer.class,
                schema
            );
            assertThat(indexCount).isEqualTo(1);
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    @Test
    void migrationWaitsForInFlightWriteAndBackfillsCommittedRow()
        throws Exception {
        String schema = "application_cv_usage_lock_test";
        UUID applicationId = UUID.randomUUID();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        try {
            Flyway.configure()
                .dataSource(
                    POSTGRES.getJdbcUrl(),
                    POSTGRES.getUsername(),
                    POSTGRES.getPassword()
                )
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("5"))
                .load()
                .migrate();

            try (Connection writer = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(),
                POSTGRES.getUsername(),
                POSTGRES.getPassword()
            )) {
                writer.setAutoCommit(false);
                insertLegacyApplication(
                    writer,
                    schema,
                    applicationId,
                    CANDIDATE_ID,
                    CV_ID,
                    FIRST_APPLIED_AT
                );

                Future<?> migration = executor.submit(() ->
                    Flyway.configure()
                        .dataSource(
                            POSTGRES.getJdbcUrl(),
                            POSTGRES.getUsername(),
                            POSTGRES.getPassword()
                        )
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .load()
                        .migrate()
                );

                assertThat(waitForBlockedMigration(schema)).isTrue();
                assertThat(migration.isDone()).isFalse();
                writer.commit();
                migration.get(10, TimeUnit.SECONDS);
            }

            Map<String, Object> usage = jdbc.queryForMap(
                "SELECT candidate_id, first_used_at, application_count " +
                    "FROM " + schema + ".application_cv_usage " +
                    "WHERE cv_id = ?",
                CV_ID
            );
            assertThat(usage.get("candidate_id")).isEqualTo(CANDIDATE_ID);
            assertThat(((Timestamp) usage.get("first_used_at")).toInstant())
                .isEqualTo(FIRST_APPLIED_AT);
            assertThat(((Number) usage.get("application_count")).longValue())
                .isEqualTo(1);
            assertThat(jdbc.queryForObject(
                "SELECT state FROM " + schema +
                    ".cv_submission_gates WHERE cv_id = ?",
                String.class,
                CV_ID
            )).isEqualTo("OPEN");
        } finally {
            executor.shutdownNow();
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private ApplicationEntity save(
        UUID candidateId,
        UUID cvId,
        Instant appliedAt
    ) {
        return applications.saveAndFlush(application(
            candidateId,
            cvId,
            appliedAt
        ));
    }

    private ApplicationEntity application(
        UUID candidateId,
        UUID cvId,
        Instant appliedAt
    ) {
        return ApplicationEntity.applied(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            candidateId,
            UUID.randomUUID(),
            cvId,
            "Backend Engineer",
            null,
            ApplicationSource.SEARCH,
            appliedAt
        );
    }

    private boolean waitForBlockedMigration(String schema) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        do {
            Boolean waiting = jdbc.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_locks
                    WHERE relation = to_regclass(?)
                      AND mode = 'ShareRowExclusiveLock'
                      AND NOT granted
                )
                """,
                Boolean.class,
                schema + ".applications"
            );
            if (Boolean.TRUE.equals(waiting)) return true;
            LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(10));
        } while (System.nanoTime() < deadline);
        return false;
    }

    private void insertLegacyApplication(
        Connection connection,
        String schema,
        UUID id,
        UUID candidateId,
        UUID cvId,
        Instant appliedAt
    ) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
            "INSERT INTO " + schema + ".applications (" +
                "id, job_id, company_id, candidate_id, recruiter_id, cv_id, " +
                "job_title, cover_letter, status, source, match_score, " +
                "applied_at, updated_at, version" +
                ") VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'APPLIED', " +
                "'SEARCH', NULL, ?, ?, 0)"
        )) {
            statement.setObject(1, id);
            statement.setObject(2, UUID.randomUUID());
            statement.setObject(3, UUID.randomUUID());
            statement.setObject(4, candidateId);
            statement.setObject(5, UUID.randomUUID());
            statement.setObject(6, cvId);
            statement.setString(7, "Backend Engineer");
            statement.setTimestamp(8, Timestamp.from(appliedAt));
            statement.setTimestamp(9, Timestamp.from(appliedAt));
            statement.executeUpdate();
        }
    }

    private void insertLegacyApplication(
        String schema,
        UUID id,
        UUID candidateId,
        UUID cvId,
        Instant appliedAt
    ) {
        jdbc.update(
            "INSERT INTO " + schema + ".applications (" +
                "id, job_id, company_id, candidate_id, recruiter_id, cv_id, " +
                "job_title, cover_letter, status, source, match_score, " +
                "applied_at, updated_at, version" +
                ") VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'APPLIED', " +
                "'SEARCH', NULL, ?, ?, 0)",
            id,
            UUID.randomUUID(),
            UUID.randomUUID(),
            candidateId,
            UUID.randomUUID(),
            cvId,
            "Backend Engineer",
            Timestamp.from(appliedAt),
            Timestamp.from(appliedAt)
        );
    }
}
