package com.recruitment.interview.query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.interview.api.BusinessException;
import com.recruitment.interview.client.ApplicationAuthorizationContext;
import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.client.CompanyMemberRole;
import com.recruitment.interview.client.CompanyMembershipClient;
import com.recruitment.interview.client.RecruiterCompanyMembership;
import com.recruitment.interview.domain.InterviewStatus;
import com.recruitment.interview.query.InterviewQueryModels.Availability;
import com.recruitment.interview.query.InterviewQueryModels.Item;
import com.recruitment.interview.query.InterviewQueryModels.Page;
import com.recruitment.interview.query.InterviewQueryService.AvailabilityQuery;
import com.recruitment.interview.query.InterviewQueryService.CalendarQuery;
import com.recruitment.interview.query.InterviewQueryService.HistoryQuery;
import com.recruitment.interview.query.InterviewQueryService.Viewer;
import com.recruitment.interview.query.InterviewQueryService.ViewerRole;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@SpringBootTest
class InterviewQueryPostgresIT {
    private static final String INTERNAL_KEY =
        "interview-query-application-integration-key-00000001";
    private static final String CURSOR_KEY =
        "interview-query-pagination-integration-key-000000001";
    private static final Path PUBLIC_KEY = createPublicKey();
    private static final Instant NOW =
        Instant.parse("2026-08-28T12:00:00.000Z");

    private static final UUID CANDIDATE_A = uuid(
        "11111111-1111-4111-8111-111111111111"
    );
    private static final UUID CANDIDATE_B = uuid(
        "11111111-1111-4111-8111-111111111112"
    );
    private static final UUID RECRUITER_A = uuid(
        "22222222-2222-4222-8222-222222222221"
    );
    private static final UUID RECRUITER_B = uuid(
        "22222222-2222-4222-8222-222222222222"
    );
    private static final UUID COMPANY_A = uuid(
        "33333333-3333-4333-8333-333333333331"
    );
    private static final UUID COMPANY_B = uuid(
        "33333333-3333-4333-8333-333333333332"
    );
    private static final UUID JOB_A = uuid(
        "44444444-4444-4444-8444-444444444441"
    );
    private static final UUID APPLICATION_A = uuid(
        "55555555-5555-4555-8555-555555555551"
    );

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("interview_query_test")
            .withUsername("interview")
            .withPassword("interview");

    @Autowired
    private InterviewQueryService queries;
    @Autowired
    private InterviewReadRepository repository;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private Flyway flyway;

    @MockBean
    private CompanyMembershipClient companies;
    @MockBean
    private ApplicationClient applications;
    @MockBean
    private Clock clock;
    @MockBean
    private JwtDecoder jwtDecoder;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("JWT_PUBLIC_KEY_PATH", () -> PUBLIC_KEY.toString());
        registry.add("APPLICATION_INTERNAL_API_KEY", () -> INTERNAL_KEY);
        registry.add(
            "interview.application-client.internal-api-key",
            () -> INTERNAL_KEY
        );
        registry.add("INTERVIEW_CURSOR_HMAC_KEY", () -> CURSOR_KEY);
        registry.add("interview-events.publisher-enabled", () -> "false");
    }

    @BeforeEach
    void setUp() {
        jdbc.execute("""
            TRUNCATE TABLE
                interview.interview_event_outbox,
                interview.interviews
            CASCADE
            """);
        when(clock.instant()).thenReturn(NOW);
    }

    @Test
    void roleAwareDetailIsDatabaseScopedAndCandidateProjectionIsPrivate() {
        UUID interviewId = uuid(
            "66666666-6666-4666-8666-666666666661"
        );
        insert(
            interviewId,
            APPLICATION_A,
            COMPANY_A,
            JOB_A,
            CANDIDATE_A,
            RECRUITER_A,
            Instant.parse("2026-09-10T02:00:00.000Z"),
            Instant.parse("2026-09-10T02:45:00.000Z"),
            InterviewStatus.SCHEDULED
        );

        Item candidate = queries.detail(
            new Viewer(CANDIDATE_A, ViewerRole.CANDIDATE),
            "candidate-token",
            interviewId.toString()
        );
        assertThat(candidate.id()).isEqualTo(interviewId);
        assertThat(candidate.companyId()).isNull();
        assertThat(candidate.candidateId()).isNull();
        assertThat(candidate.interviewerId()).isNull();
        assertThat(candidate.scheduledBy()).isNull();
        assertThat(candidate.notes()).isNull();
        assertThat(candidate.createdAt()).isNull();
        verifyNoInteractions(companies);

        assertNotFound(() -> queries.detail(
            new Viewer(CANDIDATE_B, ViewerRole.CANDIDATE),
            "candidate-token",
            interviewId.toString()
        ));

        when(companies.resolve(RECRUITER_A, "recruiter-token"))
            .thenReturn(new RecruiterCompanyMembership(
                COMPANY_A,
                CompanyMemberRole.MEMBER
            ));
        Item recruiter = queries.detail(
            new Viewer(RECRUITER_A, ViewerRole.RECRUITER),
            "recruiter-token",
            interviewId.toString()
        );
        assertThat(recruiter.companyId()).isEqualTo(COMPANY_A);
        assertThat(recruiter.candidateId()).isEqualTo(CANDIDATE_A);
        assertThat(recruiter.interviewerId()).isEqualTo(RECRUITER_A);
        assertThat(recruiter.notes()).isEqualTo("Internal scorecard");
        assertThat(recruiter.createdAt()).isEqualTo(NOW.minusSeconds(3600));

        when(companies.resolve(RECRUITER_B, "other-token"))
            .thenReturn(new RecruiterCompanyMembership(
                COMPANY_B,
                CompanyMemberRole.OWNER
            ));
        assertNotFound(() -> queries.detail(
            new Viewer(RECRUITER_B, ViewerRole.RECRUITER),
            "other-token",
            interviewId.toString()
        ));
    }

    @Test
    void signedKeysetPaginatesTiesWithoutDuplicatesAndBindsLimit() {
        when(companies.resolve(RECRUITER_A, "recruiter-token"))
            .thenReturn(new RecruiterCompanyMembership(
                COMPANY_A,
                CompanyMemberRole.MEMBER
            ));
        Instant start = Instant.parse("2026-09-11T02:00:00.000Z");
        for (int index = 1; index <= 3; index++) {
            insert(
                uuid("66666666-6666-4666-8666-66666666666" + index),
                uuid("55555555-5555-4555-8555-55555555555" + index),
                COMPANY_A,
                JOB_A,
                uuid("11111111-1111-4111-8111-11111111111" + (index + 2)),
                uuid("22222222-2222-4222-8222-22222222222" + (index + 2)),
                start,
                start.plus(30, ChronoUnit.MINUTES),
                InterviewStatus.SCHEDULED
            );
        }

        HistoryQuery firstQuery = new HistoryQuery(
            null,
            JOB_A.toString(),
            null,
            null,
            List.of(),
            "2",
            null
        );
        Page first = queries.history(
            new Viewer(RECRUITER_A, ViewerRole.RECRUITER),
            "recruiter-token",
            firstQuery
        );
        assertThat(first.items()).hasSize(2);
        assertThat(first.nextCursor()).isNotBlank();

        Page second = queries.history(
            new Viewer(RECRUITER_A, ViewerRole.RECRUITER),
            "recruiter-token",
            new HistoryQuery(
                null,
                JOB_A.toString(),
                null,
                null,
                List.of(),
                "2",
                first.nextCursor()
            )
        );
        assertThat(second.items()).hasSize(1);
        assertThat(second.nextCursor()).isNull();
        assertThat(
            List.of(
                first.items().get(0).id(),
                first.items().get(1).id(),
                second.items().get(0).id()
            )
        ).doesNotHaveDuplicates();

        assertThatThrownBy(() -> queries.history(
            new Viewer(RECRUITER_A, ViewerRole.RECRUITER),
            "recruiter-token",
            new HistoryQuery(
                null,
                JOB_A.toString(),
                null,
                null,
                List.of(),
                "3",
                first.nextCursor()
            )
        )).isInstanceOfSatisfying(
            BusinessException.class,
            error -> assertThat(error.code())
                .isEqualTo("INTERVIEW_CURSOR_INVALID")
        );
    }

    @Test
    void companyCalendarUsesHalfOpenOverlapAndAvailabilityHidesBusySource() {
        when(companies.resolve(RECRUITER_A, "recruiter-token"))
            .thenReturn(new RecruiterCompanyMembership(
                COMPANY_A,
                CompanyMemberRole.OWNER
            ));
        insert(
            uuid("66666666-6666-4666-8666-666666666671"),
            uuid("55555555-5555-4555-8555-555555555571"),
            COMPANY_A,
            JOB_A,
            uuid("11111111-1111-4111-8111-111111111171"),
            uuid("22222222-2222-4222-8222-222222222271"),
            Instant.parse("2026-09-10T01:45:00.000Z"),
            Instant.parse("2026-09-10T02:30:00.000Z"),
            InterviewStatus.SCHEDULED
        );
        insert(
            uuid("66666666-6666-4666-8666-666666666672"),
            uuid("55555555-5555-4555-8555-555555555572"),
            COMPANY_A,
            JOB_A,
            uuid("11111111-1111-4111-8111-111111111172"),
            uuid("22222222-2222-4222-8222-222222222272"),
            Instant.parse("2026-09-10T01:30:00.000Z"),
            Instant.parse("2026-09-10T02:00:00.000Z"),
            InterviewStatus.SCHEDULED
        );
        insert(
            uuid("66666666-6666-4666-8666-666666666673"),
            uuid("55555555-5555-4555-8555-555555555573"),
            COMPANY_A,
            JOB_A,
            uuid("11111111-1111-4111-8111-111111111173"),
            uuid("22222222-2222-4222-8222-222222222273"),
            Instant.parse("2026-09-10T03:00:00.000Z"),
            Instant.parse("2026-09-10T03:30:00.000Z"),
            InterviewStatus.SCHEDULED
        );

        Page calendar = queries.calendar(
            new Viewer(RECRUITER_A, ViewerRole.RECRUITER),
            "recruiter-token",
            new CalendarQuery(
                "2026-09-10T02:00:00.000Z",
                "2026-09-10T03:00:00.000Z",
                null,
                null,
                null,
                List.of(),
                "20",
                null
            )
        );
        assertThat(calendar.items())
            .extracting(Item::id)
            .containsExactly(uuid(
                "66666666-6666-4666-8666-666666666671"
            ));

        clearInvocations(companies);
        UUID targetCandidate = uuid(
            "11111111-1111-4111-8111-111111111199"
        );
        insert(
            uuid("66666666-6666-4666-8666-666666666681"),
            uuid("55555555-5555-4555-8555-555555555581"),
            COMPANY_A,
            JOB_A,
            uuid("11111111-1111-4111-8111-111111111181"),
            RECRUITER_A,
            Instant.parse("2026-09-12T02:00:00.000Z"),
            Instant.parse("2026-09-12T02:30:00.000Z"),
            InterviewStatus.SCHEDULED
        );
        insert(
            uuid("66666666-6666-4666-8666-666666666682"),
            uuid("55555555-5555-4555-8555-555555555582"),
            COMPANY_A,
            JOB_A,
            targetCandidate,
            RECRUITER_B,
            Instant.parse("2026-09-12T03:00:00.000Z"),
            Instant.parse("2026-09-12T03:45:00.000Z"),
            InterviewStatus.CONFIRMED
        );
        insert(
            uuid("66666666-6666-4666-8666-666666666683"),
            uuid("55555555-5555-4555-8555-555555555583"),
            COMPANY_A,
            JOB_A,
            targetCandidate,
            RECRUITER_A,
            Instant.parse("2026-09-12T04:00:00.000Z"),
            Instant.parse("2026-09-12T04:30:00.000Z"),
            InterviewStatus.CANCELLED
        );
        when(applications.authorizeScheduling(
            APPLICATION_A,
            "Bearer recruiter-token"
        )).thenReturn(new ApplicationAuthorizationContext(
            APPLICATION_A,
            JOB_A,
            COMPANY_A,
            targetCandidate,
            "REVIEWING",
            4
        ));

        Availability availability = queries.availability(
            new Viewer(RECRUITER_A, ViewerRole.RECRUITER),
            "recruiter-token",
            new AvailabilityQuery(
                APPLICATION_A.toString(),
                "2026-09-12T09:00:00.000+07:00",
                "2026-09-12T12:00:00.000+07:00",
                "Asia/Ho_Chi_Minh",
                "30",
                "50",
                null
            )
        );
        assertThat(availability.slots())
            .extracting(slot -> slot.start())
            .contains(
                Instant.parse("2026-09-12T02:30:00.000Z"),
                Instant.parse("2026-09-12T03:45:00.000Z"),
                Instant.parse("2026-09-12T04:00:00.000Z")
            )
            .doesNotContain(
                Instant.parse("2026-09-12T02:00:00.000Z"),
                Instant.parse("2026-09-12T03:00:00.000Z")
            );
        verifyNoInteractions(companies);
    }

    @Test
    void repeatedMigrationIsCleanAndSnapshotTriggerBlocksDirectMutation() {
        UUID interviewId = uuid(
            "66666666-6666-4666-8666-666666666691"
        );
        insert(
            interviewId,
            APPLICATION_A,
            COMPANY_A,
            JOB_A,
            CANDIDATE_A,
            RECRUITER_A,
            Instant.parse("2026-09-13T02:00:00.000Z"),
            Instant.parse("2026-09-13T02:30:00.000Z"),
            InterviewStatus.SCHEDULED
        );

        assertThat(flyway.migrate().migrationsExecuted).isZero();
        assertThatThrownBy(() -> jdbc.update(
            "UPDATE interview.interviews SET company_id = ? WHERE id = ?",
            COMPANY_B,
            interviewId
        )).isInstanceOf(DataAccessException.class);

        assertThat(jdbc.update(
            """
            UPDATE interview.interviews
            SET status = 'CANCELLED',
                cancelled_at = ?,
                cancelled_by = ?,
                cancel_reason = 'Recruiter cancelled',
                updated_at = ?,
                version = version + 1
            WHERE id = ?
            """,
            Timestamp.from(NOW),
            RECRUITER_A,
            Timestamp.from(NOW),
            interviewId
        )).isEqualTo(1);
        assertThat(jdbc.queryForObject(
            "SELECT status FROM interview.interviews WHERE id = ?",
            String.class,
            interviewId
        )).isEqualTo("CANCELLED");
    }

    private void insert(
        UUID id,
        UUID applicationId,
        UUID companyId,
        UUID jobId,
        UUID candidateId,
        UUID interviewerId,
        Instant start,
        Instant end,
        InterviewStatus status
    ) {
        int duration = Math.toIntExact(
            Duration.between(start, end).toMinutes()
        );
        jdbc.update(
            """
            INSERT INTO interview.interviews (
                id, application_id, application_version,
                application_status_at_schedule, company_id, job_id,
                candidate_id, interviewer_id, scheduled_by,
                request_id, request_hash, round_number, schedule_revision,
                scheduled_start_at, scheduled_end_at, time_zone,
                duration_minutes, mode, location, notes, status,
                created_at, updated_at, version
            ) VALUES (
                ?, ?, 4, 'REVIEWING', ?, ?, ?, ?, ?,
                ?, repeat('a', 64), 1, 1,
                ?, ?, 'Asia/Ho_Chi_Minh',
                ?, 'OFFLINE', 'Room 2', 'Internal scorecard', ?,
                ?, ?, 0
            )
            """,
            id,
            applicationId,
            companyId,
            jobId,
            candidateId,
            interviewerId,
            interviewerId,
            UUID.randomUUID(),
            Timestamp.from(start),
            Timestamp.from(end),
            duration,
            status.name(),
            Timestamp.from(NOW.minusSeconds(3600)),
            Timestamp.from(NOW.minusSeconds(3600))
        );
    }

    private void assertNotFound(Runnable invocation) {
        assertThatThrownBy(invocation::run).isInstanceOfSatisfying(
            BusinessException.class,
            error -> {
                assertThat(error.status()).isEqualTo(
                    org.springframework.http.HttpStatus.NOT_FOUND
                );
                assertThat(error.code()).isEqualTo("INTERVIEW_NOT_FOUND");
            }
        );
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }

    private static Path createPublicKey() {
        try {
            var generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            byte[] encoded = generator.generateKeyPair()
                .getPublic()
                .getEncoded();
            String pem = "-----BEGIN PUBLIC KEY-----\n" +
                Base64.getMimeEncoder(64, new byte[] {'\n'})
                    .encodeToString(encoded) +
                "\n-----END PUBLIC KEY-----\n";
            Path path = Files.createTempFile(
                "interview-query-public-",
                ".pem"
            );
            Files.writeString(path, pem, StandardCharsets.US_ASCII);
            path.toFile().deleteOnExit();
            return path;
        } catch (Exception exception) {
            throw new IllegalStateException(
                "Unable to create test public key",
                exception
            );
        }
    }
}
