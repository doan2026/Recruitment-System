package com.recruitment.application.submission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.repository.ApplicationRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
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
    "application-events.topic=application-events",
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
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import({
    CvSubmissionGateService.class,
    ApplicationProfileSkillSnapshotWriter.class,
    SubmissionTransactionService.class,
    ApplicationSkillSnapshotPostgresIT.JacksonConfiguration.class
})
class ApplicationSkillSnapshotPostgresIT {
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000001"
    );
    private static final UUID COMPANY_ID = UUID.fromString(
        "20000000-0000-4000-8000-000000000001"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "30000000-0000-4000-8000-000000000001"
    );
    private static final Instant NOW = Instant.parse(
        "2026-08-28T08:00:00Z"
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
    private SubmissionTransactionService transactions;

    @Autowired
    private ApplicationRepository applications;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @BeforeEach
    void cleanDatabase() {
        jdbc.execute(
            """
            TRUNCATE TABLE
                application.application_profile_skill_snapshots,
                application.application_event_outbox,
                application.application_history,
                application.application_cv_usage,
                application.cv_submission_gates,
                application.applications
            CASCADE
            """
        );
    }

    @Test
    void submissionPersistsExactImmutableSnapshotBeforeDownstreamWrites() {
        ApplicationResponse response = submit(
            UUID.randomUUID(),
            List.of("Java", "Spring Boot", "Đám mây")
        );

        Map<String, Object> metadata = jdbc.queryForMap(
            """
            SELECT profile_skill_snapshot_schema_version,
                   profile_aggregate_version,
                   profile_skill_snapshot_expected_count
            FROM application.applications
            WHERE id = ?
            """,
            response.id()
        );
        List<Map<String, Object>> skills = jdbc.queryForList(
            """
            SELECT skill_name, normalized_name
            FROM application.application_profile_skill_snapshots
            WHERE application_id = ?
            ORDER BY normalized_name
            """,
            response.id()
        );

        assertThat(metadata)
            .containsEntry("profile_skill_snapshot_schema_version", 1)
            .containsEntry("profile_aggregate_version", 41L)
            .containsEntry("profile_skill_snapshot_expected_count", 3);
        assertThat(skills).containsExactly(
            Map.of("skill_name", "Java", "normalized_name", "java"),
            Map.of(
                "skill_name",
                "Spring Boot",
                "normalized_name",
                "spring boot"
            ),
            Map.of(
                "skill_name",
                "Đám mây",
                "normalized_name",
                "đám mây"
            )
        );
        assertThat(count("application_history", response.id())).isEqualTo(1);
        assertThat(count("application_event_outbox", response.id()))
            .isEqualTo(1);
    }

    @Test
    void malformedSnapshotRollsBackParentUsageAndDownstreamWrites() {
        UUID cvId = UUID.randomUUID();

        assertThatThrownBy(() -> submit(
            cvId,
            List.of("Java", "JAVA")
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("PROFILE_SERVICE_INVALID_RESPONSE");

        assertThat(tableCount("applications")).isZero();
        assertThat(tableCount("application_profile_skill_snapshots"))
            .isZero();
        assertThat(tableCount("application_cv_usage")).isZero();
        assertThat(tableCount("cv_submission_gates")).isZero();
        assertThat(tableCount("application_history")).isZero();
        assertThat(tableCount("application_event_outbox")).isZero();
    }

    @Test
    void databaseRejectsInvalidNamesAndCaseInsensitiveDuplicates() {
        assertRejectedSnapshot(List.of(""));
        assertRejectedSnapshot(List.of(" Java"));
        assertRejectedSnapshot(List.of("Java "));
        assertRejectedSnapshot(List.of("Java\nScript"));
        assertRejectedSnapshot(List.of("Java", "jAvA"));
    }

    @Test
    void emptySnapshotCommitsWithExpectedCountZero() {
        ApplicationResponse response = submit(
            UUID.randomUUID(),
            List.of()
        );

        assertThat(jdbc.queryForObject(
            "SELECT profile_skill_snapshot_expected_count " +
                "FROM application.applications WHERE id = ?",
            Integer.class,
            response.id()
        )).isZero();
        assertThat(count(
            "application_profile_skill_snapshots",
            response.id()
        )).isZero();
        assertThat(count("application_history", response.id())).isEqualTo(1);
        assertThat(count("application_event_outbox", response.id()))
            .isEqualTo(1);
    }

    @Test
    void lateSkillInsertCannotChangeACommittedSnapshot() {
        ApplicationResponse response = submit(
            UUID.randomUUID(),
            List.of("Java")
        );

        assertThatThrownBy(() -> insertSkill(response.id(), "Kotlin"))
            .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(jdbc.queryForList(
            "SELECT skill_name FROM " +
                "application.application_profile_skill_snapshots " +
                "WHERE application_id = ?",
            String.class,
            response.id()
        )).containsExactly("Java");
    }

    @Test
    void incompleteSnapshotFailsDeferredCheckAndRollsBackParent() {
        UUID applicationId = UUID.randomUUID();
        TransactionTemplate transaction = new TransactionTemplate(
            transactionManager
        );

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            insertApplication(
                applicationId,
                UUID.randomUUID(),
                1,
                41L,
                2
            );
            insertSkill(applicationId, "Java");
        })).hasRootCauseInstanceOf(PSQLException.class);

        assertThat(tableCount("applications")).isZero();
        assertThat(tableCount("application_profile_skill_snapshots"))
            .isZero();
        assertThat(tableCount("application_cv_usage")).isZero();
        assertThat(tableCount("cv_submission_gates")).isZero();
    }

    @Test
    void metadataAndChildRowsAreImmutableButParentCascadeIsAllowed() {
        ApplicationResponse response = submit(
            UUID.randomUUID(),
            List.of("Java")
        );

        assertThatThrownBy(() -> jdbc.update(
            "UPDATE application.applications " +
                "SET profile_aggregate_version = 42 WHERE id = ?",
            response.id()
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(
            "UPDATE application.applications " +
                "SET profile_skill_snapshot_expected_count = 2 " +
                "WHERE id = ?",
            response.id()
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(
            "UPDATE application.application_profile_skill_snapshots " +
                "SET skill_name = 'Kotlin' WHERE application_id = ?",
            response.id()
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(
            "DELETE FROM application.application_profile_skill_snapshots " +
                "WHERE application_id = ?",
            response.id()
        )).isInstanceOf(DataIntegrityViolationException.class);

        applications.deleteById(response.id());

        assertThat(applications.findById(response.id())).isEmpty();
        assertThat(tableCount("application_profile_skill_snapshots"))
            .isZero();
    }

    @Test
    void metadataMustBeNullForLegacyOrUseSupportedBoundedTriple() {
        insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            null,
            null,
            null
        );

        assertThatThrownBy(() -> insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            1,
            null,
            0
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            null,
            1L,
            0
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            1,
            1L,
            null
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            2,
            1L,
            0
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            1,
            0L,
            0
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            1,
            1L,
            -1
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertApplication(
            UUID.randomUUID(),
            UUID.randomUUID(),
            1,
            1L,
            101
        )).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void v8DoesNotBackfillLegacyApplications() {
        String schema = "application_skill_snapshot_legacy_test";
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
                .target(MigrationVersion.fromVersion("7"))
                .load()
                .migrate();
            UUID applicationId = UUID.randomUUID();
            insertLegacyApplication(schema, applicationId, UUID.randomUUID());

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

            Map<String, Object> metadata = jdbc.queryForMap(
                "SELECT profile_skill_snapshot_schema_version, " +
                    "profile_aggregate_version, " +
                    "profile_skill_snapshot_expected_count FROM " + schema +
                    ".applications WHERE id = ?",
                applicationId
            );
            assertThat(metadata.values()).containsOnlyNulls();
            assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + schema +
                    ".application_profile_skill_snapshots",
                Long.class
            )).isZero();
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private ApplicationResponse submit(
        UUID cvId,
        List<String> skills
    ) {
        UUID jobId = UUID.randomUUID();
        return transactions.create(
            CANDIDATE_ID,
            new CreateApplicationRequest(
                jobId,
                cvId,
                null,
                ApplicationSource.SEARCH
            ),
            new JobAvailability(
                jobId,
                true,
                true,
                null,
                COMPANY_ID,
                RECRUITER_ID,
                "Backend Engineer",
                "PUBLISHED",
                "2099-12-31"
            ),
            new ProfileSkillSnapshot(1, 41L, skills)
        );
    }

    private void assertRejectedSnapshot(List<String> skills) {
        assertThatThrownBy(() -> submit(UUID.randomUUID(), skills))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("PROFILE_SERVICE_INVALID_RESPONSE");
    }

    private void insertSkill(UUID applicationId, String skill) {
        jdbc.update(
            "INSERT INTO " +
                "application.application_profile_skill_snapshots " +
                "(application_id, skill_name) VALUES (?, ?)",
            applicationId,
            skill
        );
    }

    private long tableCount(String table) {
        return jdbc.queryForObject(
            "SELECT COUNT(*) FROM application." + table,
            Long.class
        );
    }

    private long count(String table, UUID applicationId) {
        return jdbc.queryForObject(
            "SELECT COUNT(*) FROM application." + table +
                " WHERE " +
                (table.equals("application_event_outbox")
                    ? "aggregate_id"
                    : "application_id") +
                " = ?",
            Long.class,
            applicationId
        );
    }

    private void insertApplication(
        UUID applicationId,
        UUID cvId,
        Integer schemaVersion,
        Long profileVersion,
        Integer expectedCount
    ) {
        jdbc.update(
            """
            INSERT INTO application.applications (
                id, job_id, company_id, candidate_id, recruiter_id, cv_id,
                job_title, cover_letter, status, source, match_score,
                applied_at, updated_at, version,
                profile_skill_snapshot_schema_version,
                profile_aggregate_version,
                profile_skill_snapshot_expected_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'APPLIED', 'SEARCH', NULL,
                      ?, ?, 0, ?, ?, ?)
            """,
            applicationId,
            UUID.randomUUID(),
            COMPANY_ID,
            CANDIDATE_ID,
            RECRUITER_ID,
            cvId,
            "Backend Engineer",
            Timestamp.from(NOW),
            Timestamp.from(NOW),
            schemaVersion,
            profileVersion,
            expectedCount
        );
    }

    private void insertLegacyApplication(
        String schema,
        UUID applicationId,
        UUID cvId
    ) {
        jdbc.update(
            "INSERT INTO " + schema + ".applications (" +
                "id, job_id, company_id, candidate_id, recruiter_id, cv_id, " +
                "job_title, cover_letter, status, source, match_score, " +
                "applied_at, updated_at, version" +
                ") VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'APPLIED', " +
                "'SEARCH', NULL, ?, ?, 0)",
            applicationId,
            UUID.randomUUID(),
            COMPANY_ID,
            CANDIDATE_ID,
            RECRUITER_ID,
            cvId,
            "Backend Engineer",
            Timestamp.from(NOW),
            Timestamp.from(NOW)
        );
    }

    @TestConfiguration
    static class JacksonConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper().findAndRegisterModules();
        }
    }
}
