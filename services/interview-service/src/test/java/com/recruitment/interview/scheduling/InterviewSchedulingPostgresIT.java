package com.recruitment.interview.scheduling;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.recruitment.interview.api.BusinessException;
import com.recruitment.interview.client.ApplicationAuthorizationContext;
import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.repository.InterviewRepository;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@SpringBootTest
class InterviewSchedulingPostgresIT {
    private static final String INTERNAL_KEY =
        "interview-to-application-integration-key-000000000001";
    private static final Path PUBLIC_KEY = createPublicKey();

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("interview_test")
            .withUsername("interview")
            .withPassword("interview");

    @Autowired
    private InterviewSchedulingService scheduling;
    @Autowired
    private InterviewRepository interviews;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private Flyway flyway;

    @MockBean
    private ApplicationClient applications;
    @MockBean
    private JwtDecoder jwtDecoder;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("JWT_PUBLIC_KEY_PATH", () -> PUBLIC_KEY.toString());
        registry.add(
            "APPLICATION_INTERNAL_API_KEY",
            () -> INTERNAL_KEY
        );
        registry.add(
            "interview.application-client.internal-api-key",
            () -> INTERNAL_KEY
        );
        registry.add(
            "interview-events.publisher-enabled",
            () -> "false"
        );
    }

    @BeforeEach
    void clearDatabase() {
        jdbc.execute(
            """
            TRUNCATE TABLE
                interview.interview_event_outbox,
                interview.interviews
            CASCADE
            """
        );
    }

    @AfterAll
    static void removePublicKey() throws Exception {
        Files.deleteIfExists(PUBLIC_KEY);
    }

    @Test
    void cleanMigrationJpaValidationAndSecondFlywayRunAreStable() {
        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.info().current().getVersion().getVersion())
            .isEqualTo("2");
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM pg_extension WHERE extname = 'btree_gist'",
            Integer.class
        )).isEqualTo(1);
        assertThat(jdbc.queryForObject(
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = 'interview'
              AND table_name = 'interview_event_outbox'
            """,
            Integer.class
        )).isEqualTo(1);
    }

    @Test
    void storesUtcInstantsAndAllowsHalfOpenAdjacentSlots() {
        UUID actor = UUID.randomUUID();
        UUID candidate = UUID.randomUUID();
        UUID firstApplication = UUID.randomUUID();
        UUID secondApplication = UUID.randomUUID();
        stub(firstApplication, candidate);
        stub(secondApplication, candidate);
        OffsetDateTime firstStart = futureStart();
        CreateInterviewRequest firstRequest = request(
            firstApplication,
            UUID.randomUUID(),
            1,
            firstStart,
            45,
            "Room A"
        );
        ScheduleInterviewResult first = scheduling.schedule(
            actor,
            "token",
            firstRequest
        );
        CreateInterviewRequest adjacentRequest = request(
            secondApplication,
            UUID.randomUUID(),
            1,
            firstStart.plusMinutes(45),
            45,
            "Room B"
        );
        ScheduleInterviewResult adjacent = scheduling.schedule(
            actor,
            "token",
            adjacentRequest
        );

        assertThat(interviews.count()).isEqualTo(2);
        assertThat(first.interview().scheduledEnd())
            .isEqualTo(adjacent.interview().scheduledStart());
        Instant persisted = jdbc.queryForObject(
            "SELECT scheduled_start_at FROM interview.interviews WHERE id = ?",
            (resultSet, row) -> resultSet.getTimestamp(1).toInstant(),
            first.interview().id()
        );
        assertThat(persisted).isEqualTo(firstStart.toInstant());
    }

    @Test
    void retriesSameRequestAndRejectsChangedPayload() {
        UUID actor = UUID.randomUUID();
        UUID applicationId = UUID.randomUUID();
        UUID requestId = UUID.randomUUID();
        stub(applicationId, UUID.randomUUID());
        CreateInterviewRequest request = request(
            applicationId,
            requestId,
            1,
            futureStart(),
            45,
            "Room A"
        );

        ScheduleInterviewResult first = scheduling.schedule(
            actor,
            "token",
            request
        );
        ScheduleInterviewResult replay = scheduling.schedule(
            actor,
            "new-token",
            request
        );

        assertThat(replay.replayed()).isTrue();
        assertThat(replay.interview().id()).isEqualTo(first.interview().id());
        assertThat(interviews.count()).isOne();
        assertThat(outboxCount()).isOne();

        CreateInterviewRequest changed = request(
            applicationId,
            requestId,
            1,
            request.scheduledStart(),
            45,
            "Different room"
        );
        assertThatThrownBy(() -> scheduling.schedule(
            actor,
            "token",
            changed
        )).isInstanceOfSatisfying(BusinessException.class, exception ->
            assertThat(exception.code()).isEqualTo(
                "INTERVIEW_IDEMPOTENCY_CONFLICT"
            )
        );
    }

    @Test
    void outboxFailureRollsBackTheInterviewTransaction() {
        UUID actor = UUID.randomUUID();
        UUID applicationId = UUID.randomUUID();
        stub(applicationId, UUID.randomUUID());
        jdbc.execute(
            """
            CREATE OR REPLACE FUNCTION interview.reject_test_outbox()
            RETURNS TRIGGER
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION USING
                    ERRCODE = 'check_violation',
                    MESSAGE = 'forced test outbox failure';
            END;
            $$
            """
        );
        jdbc.execute(
            """
            CREATE TRIGGER reject_test_outbox
            BEFORE INSERT ON interview.interview_event_outbox
            FOR EACH ROW EXECUTE FUNCTION interview.reject_test_outbox()
            """
        );
        try {
            assertThatThrownBy(() -> scheduling.schedule(
                actor,
                "token",
                request(
                    applicationId,
                    UUID.randomUUID(),
                    1,
                    futureStart(),
                    45,
                    "Room A"
                )
            )).isInstanceOf(DataIntegrityViolationException.class);
        } finally {
            jdbc.execute(
                """
                DROP TRIGGER IF EXISTS reject_test_outbox
                ON interview.interview_event_outbox
                """
            );
            jdbc.execute(
                "DROP FUNCTION IF EXISTS interview.reject_test_outbox()"
            );
        }

        assertThat(interviews.count()).isZero();
        assertThat(outboxCount()).isZero();
    }

    @Test
    void activeApplicationRoundIsUniqueEvenAtDifferentTimes() {
        UUID actor = UUID.randomUUID();
        UUID applicationId = UUID.randomUUID();
        stub(applicationId, UUID.randomUUID());
        OffsetDateTime start = futureStart();
        scheduling.schedule(actor, "token", request(
            applicationId,
            UUID.randomUUID(),
            3,
            start,
            30,
            "Room A"
        ));

        assertThatThrownBy(() -> scheduling.schedule(
            actor,
            "token",
            request(
                applicationId,
                UUID.randomUUID(),
                3,
                start.plusHours(3),
                30,
                "Room B"
            )
        )).isInstanceOfSatisfying(BusinessException.class, exception ->
            assertThat(exception.code()).isEqualTo(
                "INTERVIEW_ROUND_ALREADY_SCHEDULED"
            )
        );
    }

    @Test
    void cancelledInterviewReleasesCandidateAndInterviewerCalendars() {
        UUID actor = UUID.randomUUID();
        UUID candidate = UUID.randomUUID();
        UUID firstApplication = UUID.randomUUID();
        UUID secondApplication = UUID.randomUUID();
        stub(firstApplication, candidate);
        stub(secondApplication, candidate);
        OffsetDateTime start = futureStart();
        ScheduleInterviewResult first = scheduling.schedule(
            actor,
            "token",
            request(
                firstApplication,
                UUID.randomUUID(),
                1,
                start,
                60,
                "Room A"
            )
        );
        jdbc.update(
            "UPDATE interview.interviews SET status = 'CANCELLED' WHERE id = ?",
            first.interview().id()
        );

        ScheduleInterviewResult replacement = scheduling.schedule(
            actor,
            "token",
            request(
                secondApplication,
                UUID.randomUUID(),
                1,
                start,
                60,
                "Room B"
            )
        );

        assertThat(replacement.interview().id()).isNotNull();
        assertThat(interviews.count()).isEqualTo(2);
    }

    @Test
    void databaseRejectsDirectSqlCandidateOverlap() {
        UUID actor = UUID.randomUUID();
        UUID candidate = UUID.randomUUID();
        UUID applicationId = UUID.randomUUID();
        stub(applicationId, candidate);
        OffsetDateTime start = futureStart();
        scheduling.schedule(actor, "token", request(
            applicationId,
            UUID.randomUUID(),
            1,
            start,
            45,
            "Room A"
        ));

        assertThatThrownBy(() -> directInsert(
            UUID.randomUUID(),
            candidate,
            UUID.randomUUID(),
            start.toInstant(),
            start.toInstant().plus(30, ChronoUnit.MINUTES)
        )).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void databaseRejectsNullAndNonV4OutboxIdentity() {
        UUID actor = UUID.randomUUID();
        UUID applicationId = UUID.randomUUID();
        stub(applicationId, UUID.randomUUID());
        ScheduleInterviewResult scheduled = scheduling.schedule(
            actor,
            "token",
            request(
                applicationId,
                UUID.randomUUID(),
                1,
                futureStart(),
                45,
                "Room A"
            )
        );

        assertThatThrownBy(() -> insertOutboxCopy(
            scheduled.interview().id(),
            UUID.randomUUID(),
            1,
            true
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertOutboxCopy(
            scheduled.interview().id(),
            UUID.fromString("11111111-1111-1111-8111-111111111111"),
            1,
            false
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(outboxCount()).isOne();
    }

    @Test
    void concurrentCandidateOverlapAllowsExactlyOneCommit()
        throws Exception {
        UUID candidate = UUID.randomUUID();
        UUID firstApplication = UUID.randomUUID();
        UUID secondApplication = UUID.randomUUID();
        stub(firstApplication, candidate);
        stub(secondApplication, candidate);
        OffsetDateTime start = futureStart();

        List<Attempt> attempts = race(
            () -> scheduling.schedule(
                UUID.randomUUID(),
                "token-a",
                request(
                    firstApplication,
                    UUID.randomUUID(),
                    1,
                    start,
                    60,
                    "Room A"
                )
            ),
            () -> scheduling.schedule(
                UUID.randomUUID(),
                "token-b",
                request(
                    secondApplication,
                    UUID.randomUUID(),
                    1,
                    start,
                    60,
                    "Room B"
                )
            )
        );

        assertOneWinner(attempts, "INTERVIEW_CANDIDATE_CONFLICT");
    }

    @Test
    void concurrentInterviewerOverlapAllowsExactlyOneCommit()
        throws Exception {
        UUID actor = UUID.randomUUID();
        UUID firstApplication = UUID.randomUUID();
        UUID secondApplication = UUID.randomUUID();
        stub(firstApplication, UUID.randomUUID());
        stub(secondApplication, UUID.randomUUID());
        OffsetDateTime start = futureStart();

        List<Attempt> attempts = race(
            () -> scheduling.schedule(
                actor,
                "token-a",
                request(
                    firstApplication,
                    UUID.randomUUID(),
                    1,
                    start,
                    60,
                    "Room A"
                )
            ),
            () -> scheduling.schedule(
                actor,
                "token-b",
                request(
                    secondApplication,
                    UUID.randomUUID(),
                    1,
                    start,
                    60,
                    "Room B"
                )
            )
        );

        assertOneWinner(attempts, "INTERVIEW_INTERVIEWER_CONFLICT");
    }

    private List<Attempt> race(
        ThrowingSchedule first,
        ThrowingSchedule second
    ) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<Attempt> firstFuture = executor.submit(() ->
                attempt(first, ready, start)
            );
            Future<Attempt> secondFuture = executor.submit(() ->
                attempt(second, ready, start)
            );
            ready.await();
            start.countDown();
            return List.of(firstFuture.get(), secondFuture.get());
        } finally {
            executor.shutdownNow();
        }
    }

    private Attempt attempt(
        ThrowingSchedule action,
        CountDownLatch ready,
        CountDownLatch start
    ) throws InterruptedException {
        ready.countDown();
        start.await();
        try {
            return new Attempt(action.run(), null);
        } catch (BusinessException exception) {
            return new Attempt(null, exception);
        }
    }

    private void assertOneWinner(List<Attempt> attempts, String loserCode) {
        assertThat(attempts.stream().filter(attempt ->
            attempt.result() != null
        )).hasSize(1);
        assertThat(attempts.stream()
            .map(Attempt::error)
            .filter(error -> error != null)
            .map(BusinessException::code)
        ).allMatch(code ->
            loserCode.equals(code) || "INTERVIEW_SCHEDULE_CONFLICT".equals(code)
        );
        assertThat(interviews.count()).isOne();
        assertThat(outboxCount()).isOne();
    }

    private Long outboxCount() {
        return jdbc.queryForObject(
            "SELECT COUNT(*) FROM interview.interview_event_outbox",
            Long.class
        );
    }

    private void stub(UUID applicationId, UUID candidateId) {
        when(applications.authorizeScheduling(
            org.mockito.ArgumentMatchers.eq(applicationId),
            anyString()
        )).thenReturn(new ApplicationAuthorizationContext(
            applicationId,
            UUID.randomUUID(),
            UUID.randomUUID(),
            candidateId,
            "REVIEWING",
            4L
        ));
    }

    private CreateInterviewRequest request(
        UUID applicationId,
        UUID requestId,
        int round,
        OffsetDateTime start,
        int duration,
        String location
    ) {
        return new CreateInterviewRequest(
            applicationId,
            requestId,
            round,
            start,
            "Asia/Ho_Chi_Minh",
            duration,
            InterviewMode.OFFLINE,
            location,
            null
        );
    }

    private OffsetDateTime futureStart() {
        return OffsetDateTime.now(ZoneId.of("Asia/Ho_Chi_Minh"))
            .plusDays(30)
            .withHour(9)
            .withMinute(0)
            .withSecond(0)
            .withNano(0);
    }

    private void directInsert(
        UUID applicationId,
        UUID candidateId,
        UUID interviewerId,
        Instant start,
        Instant end
    ) {
        jdbc.update("""
            INSERT INTO interview.interviews (
                id, application_id, application_version,
                application_status_at_schedule, company_id, job_id,
                candidate_id, interviewer_id, scheduled_by,
                request_id, request_hash, round_number, schedule_revision,
                scheduled_start_at, scheduled_end_at, time_zone,
                duration_minutes, mode, location, status,
                created_at, updated_at, version
            ) VALUES (
                ?, ?, 0, 'REVIEWING', ?, ?, ?, ?, ?, ?, ?, 1, 1,
                ?, ?, 'Asia/Ho_Chi_Minh', 30, 'OFFLINE', 'Direct room',
                'SCHEDULED', clock_timestamp(), clock_timestamp(), 0
            )
            """,
            UUID.randomUUID(),
            applicationId,
            UUID.randomUUID(),
            UUID.randomUUID(),
            candidateId,
            interviewerId,
            interviewerId,
            UUID.randomUUID(),
            "a".repeat(64),
            java.sql.Timestamp.from(start),
            java.sql.Timestamp.from(end)
        );
    }

    private void insertOutboxCopy(
        UUID interviewId,
        UUID eventId,
        long aggregateVersion,
        boolean nullEventId
    ) {
        jdbc.update("""
            INSERT INTO interview.interview_event_outbox (
                event_id, interview_id, aggregate_version, action,
                topic, event_key, payload, next_attempt_at, created_at
            )
            SELECT ?, interview_id, ?, action, topic, event_key,
                   jsonb_set(
                       jsonb_set(
                           payload,
                           '{event_id}',
                           CASE WHEN ?
                               THEN 'null'::jsonb
                               ELSE to_jsonb(CAST(? AS text))
                           END
                       ),
                       '{aggregate_version}',
                       to_jsonb(CAST(? AS bigint))
                   ),
                   created_at, created_at
            FROM interview.interview_event_outbox
            WHERE interview_id = ?
            """,
            eventId,
            aggregateVersion,
            nullEventId,
            eventId,
            aggregateVersion,
            interviewId
        );
    }

    private static Path createPublicKey() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            byte[] encoded = generator.generateKeyPair().getPublic().getEncoded();
            String body = Base64.getMimeEncoder(64, new byte[] {'\n'})
                .encodeToString(encoded);
            Path file = Files.createTempFile("interview-test-public-", ".pem");
            Files.writeString(
                file,
                "-----BEGIN PUBLIC KEY-----\n" + body +
                    "\n-----END PUBLIC KEY-----\n",
                StandardCharsets.US_ASCII
            );
            return file;
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    @FunctionalInterface
    private interface ThrowingSchedule {
        ScheduleInterviewResult run();
    }

    private record Attempt(
        ScheduleInterviewResult result,
        BusinessException error
    ) {}
}
