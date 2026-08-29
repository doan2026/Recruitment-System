package com.recruitment.application.load;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.offer.ApplicationOfferService;
import com.recruitment.application.offer.CreateOfferRequest;
import com.recruitment.application.offer.OfferDecision;
import com.recruitment.application.offer.OfferResponse;
import com.recruitment.application.offer.RespondOfferRequest;
import com.recruitment.application.pipeline.ApplicationHistoryWriter;
import com.recruitment.application.pipeline.ApplicationPipelineService;
import com.recruitment.application.pipeline.ChangeApplicationStatusRequest;
import com.recruitment.application.pipeline.StatusTransitionResponse;
import com.recruitment.application.pipeline.WithdrawApplicationRequest;
import com.recruitment.application.submission.ApplicationProfileSkillSnapshotWriter;
import com.recruitment.application.submission.ApplicationResponse;
import com.recruitment.application.submission.CreateApplicationRequest;
import com.recruitment.application.submission.CvSubmissionGateService;
import com.recruitment.application.submission.ProfileSkillSnapshot;
import com.recruitment.application.submission.SubmissionTransactionService;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Controlled PostgreSQL transaction, cardinality, and state gate for five
 * critical Application write races.
 *
 * <p>The defaults execute 1,000 pairs for each workload. Every pair contains
 * two service calls, so a default run measures exactly 10,000 calls. Fixtures
 * are deterministic; production-generated aggregate/event identifiers are
 * intentionally treated as opaque.</p>
 */
@Testcontainers
@DataJpaTest(showSql = false, properties = {
    "application-events.topic=application-events",
    "logging.level.org.hibernate.engine.jdbc.spi.SqlExceptionHelper=OFF",
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
    ApplicationPipelineService.class,
    ApplicationHistoryWriter.class,
    ApplicationOfferService.class,
    ApplicationConcurrencyLoadGate.JacksonConfiguration.class
})
public class ApplicationConcurrencyLoadGate {
    private static final String PAIRS_PROPERTY =
        "application.load.pairs-per-workload";
    private static final String CONCURRENCY_PROPERTY =
        "application.load.concurrency";
    private static final String BARRIER_TIMEOUT_PROPERTY =
        "application.load.barrier-timeout-ms";
    private static final String WORKLOAD_TIMEOUT_PROPERTY =
        "application.load.workload-timeout-ms";
    private static final String P95_THRESHOLD_PROPERTY =
        "application.load.p95-threshold-ms";
    private static final String P99_THRESHOLD_PROPERTY =
        "application.load.p99-threshold-ms";
    private static final String MAX_THRESHOLD_PROPERTY =
        "application.load.max-threshold-ms";
    private static final String MIN_RPS_PROPERTY =
        "application.load.min-rps";

    private static final int PAIRS_PER_WORKLOAD = boundedInt(
        PAIRS_PROPERTY,
        1_000,
        1,
        5_000
    );
    private static final int CONCURRENCY = boundedInt(
        CONCURRENCY_PROPERTY,
        32,
        2,
        128
    );
    private static final long BARRIER_TIMEOUT_MS = boundedLong(
        BARRIER_TIMEOUT_PROPERTY,
        15_000L,
        1_000L,
        60_000L
    );
    private static final long WORKLOAD_TIMEOUT_MS = boundedLong(
        WORKLOAD_TIMEOUT_PROPERTY,
        300_000L,
        10_000L,
        900_000L
    );
    private static final long P95_THRESHOLD_MS = boundedLong(
        P95_THRESHOLD_PROPERTY,
        5_000L,
        100L,
        60_000L
    );
    private static final long P99_THRESHOLD_MS = boundedLong(
        P99_THRESHOLD_PROPERTY,
        10_000L,
        100L,
        60_000L
    );
    private static final long MAX_THRESHOLD_MS = boundedLong(
        MAX_THRESHOLD_PROPERTY,
        15_000L,
        100L,
        60_000L
    );
    private static final long MIN_RPS = boundedLong(
        MIN_RPS_PROPERTY,
        5L,
        1L,
        100_000L
    );

    static {
        if (
            P95_THRESHOLD_MS > P99_THRESHOLD_MS ||
            P99_THRESHOLD_MS > MAX_THRESHOLD_MS
        ) {
            throw new IllegalArgumentException(
                "load latency thresholds must satisfy p95 <= p99 <= max"
            );
        }
    }

    private static final String POSTGRES_IMAGE =
        "postgres@sha256:" +
        "cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";

    private static final UUID COMPANY_ID = uuid("shared", 0, "company");
    private static final UUID RECRUITER_ONE = uuid(
        "shared",
        0,
        "recruiter-one"
    );
    private static final UUID RECRUITER_TWO = uuid(
        "shared",
        0,
        "recruiter-two"
    );
    private static final String AUTHORIZATION = "Bearer load-gate";
    private static final String TOPIC = "application-events";
    private static final Instant FIXTURE_TIME = Instant.parse(
        "2026-08-29T00:00:00Z"
    );
    private static final LocalDate OFFER_START = LocalDate.of(2099, 1, 1);
    private static final Instant OFFER_EXPIRY = Instant.parse(
        "2099-02-01T00:00:00Z"
    );
    private static final List<String> SNAPSHOT_SKILLS = List.of(
        "Java",
        "PostgreSQL"
    );

    private static final String SUBMISSION_MARKER =
        "load-gate-duplicate-submission";
    private static final String PIPELINE_MARKER =
        "load-gate-pipeline-version";
    private static final String WITHDRAW_MARKER =
        "load-gate-withdraw-transition";
    private static final String SEND_OFFER_MARKER =
        "load-gate-send-offer";
    private static final String RESPOND_OFFER_MARKER =
        "load-gate-respond-offer";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(POSTGRES_IMAGE)
            .withDatabaseName("recruitment")
            .withUsername("recruitment")
            .withPassword("recruitment");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add(
            "spring.datasource.hikari.maximum-pool-size",
            () -> CONCURRENCY
        );
    }

    @Autowired
    private SubmissionTransactionService submissions;

    @Autowired
    private ApplicationPipelineService pipeline;

    @Autowired
    private ApplicationOfferService offers;

    @Autowired
    private JdbcTemplate jdbc;

    @MockBean
    private CompanyClient companies;

    private ExecutorService activeExecutor;

    @BeforeEach
    void setUp() {
        jdbc.execute(
            """
            TRUNCATE TABLE
                application.offers,
                application.evaluations,
                application.application_event_outbox,
                application.application_history,
                application.bookmarks,
                application.application_cv_usage,
                application.cv_submission_gates,
                application.application_profile_skill_snapshots,
                application.applications
            CASCADE
            """
        );
        when(companies.getRecruiterMembership(
            any(UUID.class),
            eq(AUTHORIZATION)
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
    }

    @AfterEach
    void stopExecutor() throws InterruptedException {
        ExecutorService executor = activeExecutor;
        activeExecutor = null;
        if (executor == null) return;
        executor.shutdownNow();
        assertThat(executor.awaitTermination(10, TimeUnit.SECONDS))
            .as("load-gate executor must terminate")
            .isTrue();
    }

    @Test
    void tenThousandCallsPreserveSelectedApplicationWriteInvariants()
        throws Exception {
        List<WorkloadMetrics> metrics = new ArrayList<>(5);

        metrics.add(runDuplicateSubmission());
        metrics.add(runPipelineSameVersion());
        metrics.add(runWithdrawVersusTransition());
        metrics.add(runDuplicateSendOffer());
        metrics.add(runAcceptVersusDecline());

        int expectedCalls = PAIRS_PER_WORKLOAD * 2 * metrics.size();
        assertThat(metrics)
            .extracting(WorkloadMetrics::calls)
            .containsOnly(PAIRS_PER_WORKLOAD * 2);
        assertThat(metrics.stream().mapToInt(WorkloadMetrics::calls).sum())
            .isEqualTo(expectedCalls);

        assertNoCrossWorkloadDatabaseCorruption(expectedCalls);
        WorkloadMetrics total = WorkloadMetrics.total(metrics);
        assertLatencyThreshold(total);
        printMetrics(total);
    }

    private WorkloadMetrics runDuplicateSubmission() throws Exception {
        List<CallPair> pairs = new ArrayList<>(PAIRS_PER_WORKLOAD);
        for (int pair = 0; pair < PAIRS_PER_WORKLOAD; pair++) {
            UUID candidateId = uuid(SUBMISSION_MARKER, pair, "candidate");
            UUID jobId = uuid(SUBMISSION_MARKER, pair, "job");
            UUID firstCvId = uuid(SUBMISSION_MARKER, pair, "cv-one");
            UUID secondCvId = uuid(SUBMISSION_MARKER, pair, "cv-two");
            JobAvailability job = new JobAvailability(
                jobId,
                true,
                true,
                null,
                COMPANY_ID,
                RECRUITER_ONE,
                SUBMISSION_MARKER,
                "PUBLISHED",
                "2099-12-31"
            );
            ProfileSkillSnapshot snapshot = new ProfileSkillSnapshot(
                1,
                pair + 1L,
                SNAPSHOT_SKILLS
            );
            pairs.add(new CallPair(
                () -> submissions.create(
                    candidateId,
                    submissionRequest(jobId, firstCvId),
                    job,
                    snapshot
                ),
                () -> submissions.create(
                    candidateId,
                    submissionRequest(jobId, secondCvId),
                    job,
                    snapshot
                )
            ));
        }

        WorkloadMetrics metrics = execute(
            "duplicate-submission",
            pairs,
            ApplicationResponse.class,
            Set.of("ACTIVE_APPLICATION_EXISTS")
        );
        assertSubmissionInvariants();
        assertLatencyThreshold(metrics);
        printMetrics(metrics);
        return metrics;
    }

    private WorkloadMetrics runPipelineSameVersion() throws Exception {
        List<ApplicationFixture> fixtures = insertApplications(
            PIPELINE_MARKER,
            ApplicationStatus.APPLIED,
            0L
        );
        List<CallPair> pairs = new ArrayList<>(fixtures.size());
        for (ApplicationFixture fixture : fixtures) {
            pairs.add(new CallPair(
                () -> pipeline.changeStatus(
                    fixture.applicationId(),
                    RECRUITER_ONE,
                    AUTHORIZATION,
                    new ChangeApplicationStatusRequest(
                        ApplicationStatus.REVIEWING,
                        "load gate recruiter one",
                        0L
                    )
                ),
                () -> pipeline.changeStatus(
                    fixture.applicationId(),
                    RECRUITER_TWO,
                    AUTHORIZATION,
                    new ChangeApplicationStatusRequest(
                        ApplicationStatus.REVIEWING,
                        "load gate recruiter two",
                        0L
                    )
                )
            ));
        }

        WorkloadMetrics metrics = execute(
            "pipeline-same-version",
            pairs,
            StatusTransitionResponse.class,
            Set.of("APPLICATION_CHANGED_CONCURRENTLY")
        );
        assertPipelineInvariants();
        assertLatencyThreshold(metrics);
        printMetrics(metrics);
        return metrics;
    }

    private WorkloadMetrics runWithdrawVersusTransition() throws Exception {
        List<ApplicationFixture> fixtures = insertApplications(
            WITHDRAW_MARKER,
            ApplicationStatus.REVIEWING,
            0L
        );
        List<CallPair> pairs = new ArrayList<>(fixtures.size());
        for (ApplicationFixture fixture : fixtures) {
            pairs.add(new CallPair(
                () -> pipeline.withdraw(
                    fixture.applicationId(),
                    fixture.candidateId(),
                    new WithdrawApplicationRequest(
                        "candidate withdrew during review",
                        0L
                    )
                ),
                () -> pipeline.changeStatus(
                    fixture.applicationId(),
                    RECRUITER_ONE,
                    AUTHORIZATION,
                    new ChangeApplicationStatusRequest(
                        ApplicationStatus.INTERVIEW,
                        "recruiter scheduled interview",
                        0L
                    )
                )
            ));
        }

        WorkloadMetrics metrics = execute(
            "withdraw-versus-transition",
            pairs,
            StatusTransitionResponse.class,
            Set.of("APPLICATION_CHANGED_CONCURRENTLY")
        );
        assertWithdrawTransitionInvariants();
        assertLatencyThreshold(metrics);
        printMetrics(metrics);
        return metrics;
    }

    private WorkloadMetrics runDuplicateSendOffer() throws Exception {
        List<ApplicationFixture> fixtures = insertApplications(
            SEND_OFFER_MARKER,
            ApplicationStatus.INTERVIEW,
            0L
        );
        List<CallPair> pairs = new ArrayList<>(fixtures.size());
        for (ApplicationFixture fixture : fixtures) {
            pairs.add(new CallPair(
                () -> offers.send(
                    fixture.applicationId(),
                    RECRUITER_ONE,
                    AUTHORIZATION,
                    offerRequest("recruiter one")
                ),
                () -> offers.send(
                    fixture.applicationId(),
                    RECRUITER_TWO,
                    AUTHORIZATION,
                    offerRequest("recruiter two")
                )
            ));
        }

        WorkloadMetrics metrics = execute(
            "duplicate-send-offer",
            pairs,
            OfferResponse.class,
            Set.of(
                "APPLICATION_CHANGED_CONCURRENTLY",
                "OFFER_ALREADY_EXISTS"
            )
        );
        assertSendOfferInvariants();
        assertLatencyThreshold(metrics);
        printMetrics(metrics);
        return metrics;
    }

    private WorkloadMetrics runAcceptVersusDecline() throws Exception {
        List<ApplicationFixture> fixtures = insertApplications(
            RESPOND_OFFER_MARKER,
            ApplicationStatus.OFFER,
            1L
        );
        insertSentOffers(fixtures);
        List<CallPair> pairs = new ArrayList<>(fixtures.size());
        for (ApplicationFixture fixture : fixtures) {
            UUID offerId = uuid(
                RESPOND_OFFER_MARKER,
                fixture.pair(),
                "offer"
            );
            pairs.add(new CallPair(
                () -> offers.respond(
                    offerId,
                    fixture.candidateId(),
                    new RespondOfferRequest(
                        OfferDecision.ACCEPTED,
                        null,
                        0L,
                        1L
                    )
                ),
                () -> offers.respond(
                    offerId,
                    fixture.candidateId(),
                    new RespondOfferRequest(
                        OfferDecision.DECLINED,
                        "accepted another role",
                        0L,
                        1L
                    )
                )
            ));
        }

        WorkloadMetrics metrics = execute(
            "accept-versus-decline",
            pairs,
            OfferResponse.class,
            Set.of(
                "OFFER_ALREADY_RESPONDED",
                "OFFER_CHANGED_CONCURRENTLY",
                "APPLICATION_CHANGED_CONCURRENTLY"
            )
        );
        assertOfferResponseInvariants();
        assertLatencyThreshold(metrics);
        printMetrics(metrics);
        return metrics;
    }

    private WorkloadMetrics execute(
        String name,
        List<CallPair> pairs,
        Class<?> responseType,
        Set<String> expectedConflictCodes
    ) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(CONCURRENCY);
        activeExecutor = executor;
        List<PairFutures> pairFutures = new ArrayList<>(pairs.size());
        long workloadStarted = System.nanoTime();

        for (CallPair pair : pairs) {
            CyclicBarrier startTogether = new CyclicBarrier(2);
            Future<CallResult> first = executor.submit(() -> timedCall(
                startTogether,
                pair.first()
            ));
            Future<CallResult> second = executor.submit(() -> timedCall(
                startTogether,
                pair.second()
            ));
            pairFutures.add(new PairFutures(first, second));
        }

        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(
            WORKLOAD_TIMEOUT_MS
        );
        List<PairResult> results = new ArrayList<>(pairs.size());
        try {
            for (PairFutures futures : pairFutures) {
                results.add(new PairResult(
                    getBeforeDeadline(futures.first(), deadline),
                    getBeforeDeadline(futures.second(), deadline)
                ));
            }
        } catch (TimeoutException exception) {
            pairFutures.forEach(PairFutures::cancel);
            throw new AssertionError(
                name + " exceeded workload timeout " +
                    WORKLOAD_TIMEOUT_MS + " ms",
                exception
            );
        } finally {
            executor.shutdownNow();
            boolean terminated = executor.awaitTermination(
                10,
                TimeUnit.SECONDS
            );
            activeExecutor = null;
            assertThat(terminated)
                .as("%s executor must terminate", name)
                .isTrue();
        }

        long elapsed = System.nanoTime() - workloadStarted;
        FailureSummary failures = validatePairResults(
            name,
            results,
            responseType,
            expectedConflictCodes
        );
        List<Long> latencies = results.stream()
            .flatMap(result -> result.calls().stream())
            .map(CallResult::latencyNanos)
            .toList();
        return WorkloadMetrics.of(name, latencies, elapsed, failures);
    }

    private CallResult timedCall(
        CyclicBarrier startTogether,
        CheckedCall call
    ) {
        try {
            startTogether.await(BARRIER_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Throwable failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return new CallResult(0L, null, failure);
        }

        long started = System.nanoTime();
        try {
            Object value = call.call();
            return new CallResult(
                System.nanoTime() - started,
                value,
                null
            );
        } catch (Throwable failure) {
            return new CallResult(
                System.nanoTime() - started,
                null,
                failure
            );
        }
    }

    private FailureSummary validatePairResults(
        String workload,
        List<PairResult> results,
        Class<?> responseType,
        Set<String> expectedConflictCodes
    ) {
        int successes = 0;
        int expectedConflicts = 0;
        int unexpected = 0;
        int serverErrors = 0;
        int deadlocks = 0;
        int timeouts = 0;
        List<String> examples = new ArrayList<>();

        for (int pair = 0; pair < results.size(); pair++) {
            PairResult result = results.get(pair);
            List<CallResult> successfulCalls = result.calls().stream()
                .filter(CallResult::succeeded)
                .toList();
            List<CallResult> failedCalls = result.calls().stream()
                .filter(call -> !call.succeeded())
                .toList();

            if (
                successfulCalls.size() != 1 ||
                failedCalls.size() != 1 ||
                !responseType.isInstance(successfulCalls.isEmpty()
                    ? null
                    : successfulCalls.getFirst().value())
            ) {
                unexpected++;
                addExample(
                    examples,
                    "pair=" + pair + " outcomes=" + result.describe()
                );
            } else {
                successes++;
            }

            for (CallResult failed : failedCalls) {
                Throwable failure = failed.failure();
                if (isTimeout(failure)) timeouts++;
                if (isDeadlock(failure)) deadlocks++;
                if (
                    failure instanceof BusinessException business &&
                    business.status().is5xxServerError()
                ) {
                    serverErrors++;
                }
                if (
                    failure instanceof BusinessException business &&
                    business.status() == HttpStatus.CONFLICT &&
                    expectedConflictCodes.contains(business.code())
                ) {
                    expectedConflicts++;
                } else {
                    unexpected++;
                    addExample(
                        examples,
                        "pair=" + pair + " failure=" + describe(failure)
                    );
                }
            }
        }

        assertThat(successes)
            .as("%s must have one successful call per pair", workload)
            .isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(expectedConflicts)
            .as(
                "%s must have one expected HTTP 409 per pair; examples=%s",
                workload,
                examples
            )
            .isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(unexpected)
            .as("%s unexpected outcomes: %s", workload, examples)
            .isZero();
        assertThat(serverErrors)
            .as("%s must expose no 5xx outcome", workload)
            .isZero();
        assertThat(deadlocks)
            .as("%s must have no PostgreSQL deadlock", workload)
            .isZero();
        assertThat(timeouts)
            .as("%s must have no call timeout", workload)
            .isZero();

        return new FailureSummary(
            successes,
            expectedConflicts,
            unexpected,
            serverErrors,
            deadlocks,
            timeouts
        );
    }

    private void assertSubmissionInvariants() {
        assertThat(applicationCount(SUBMISSION_MARKER))
            .isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications
            WHERE job_title = ?
              AND status = 'APPLIED'
              AND version = 0
              AND profile_skill_snapshot_schema_version = 1
              AND profile_aggregate_version > 0
              AND profile_skill_snapshot_expected_count = 2
            """,
            SUBMISSION_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM (
                SELECT candidate_id, job_id
                FROM application.applications
                WHERE job_title = ?
                GROUP BY candidate_id, job_id
                HAVING COUNT(*) <> 1
            ) invalid
            """,
            SUBMISSION_MARKER
        )).isZero();
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.application_profile_skill_snapshots snapshot
            JOIN application.applications application
              ON application.id = snapshot.application_id
            WHERE application.job_title = ?
              AND snapshot.normalized_name IN ('java', 'postgresql')
            """,
            SUBMISSION_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD * SNAPSHOT_SKILLS.size());
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM (
                SELECT application.id
                FROM application.applications application
                LEFT JOIN application.application_profile_skill_snapshots snapshot
                  ON snapshot.application_id = application.id
                WHERE application.job_title = ?
                GROUP BY application.id,
                         application.profile_skill_snapshot_expected_count
                HAVING COUNT(snapshot.application_id) <>
                       application.profile_skill_snapshot_expected_count
            ) invalid
            """,
            SUBMISSION_MARKER
        )).isZero();
        assertHistoryAndOutbox(
            SUBMISSION_MARKER,
            null,
            ApplicationStatus.APPLIED,
            0L,
            "STATUS_CHANGED"
        );
        assertGateAndUsage(SUBMISSION_MARKER);
    }

    private void assertPipelineInvariants() {
        assertApplicationState(
            PIPELINE_MARKER,
            ApplicationStatus.REVIEWING,
            1L
        );
        assertHistoryAndOutbox(
            PIPELINE_MARKER,
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            1L,
            "STATUS_CHANGED"
        );
        assertGateAndUsage(PIPELINE_MARKER);
    }

    private void assertWithdrawTransitionInvariants() {
        assertThat(applicationCount(WITHDRAW_MARKER))
            .isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications
            WHERE job_title = ?
              AND version = 1
              AND status IN ('WITHDRAWN', 'INTERVIEW')
            """,
            WITHDRAW_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.application_history history
              ON history.application_id = application.id
             AND history.from_status = 'REVIEWING'
             AND history.to_status = application.status
            WHERE application.job_title = ?
            """,
            WITHDRAW_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.application_event_outbox outbox
              ON outbox.aggregate_id = application.id
             AND outbox.payload::jsonb ->> 'from_status' = 'REVIEWING'
             AND outbox.payload::jsonb ->> 'to_status' = application.status
             AND outbox.payload::jsonb ->> 'aggregate_version' = '1'
            WHERE application.job_title = ?
            """,
            WITHDRAW_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertExactlyOneHistoryAndOutbox(WITHDRAW_MARKER);
        assertGateAndUsage(WITHDRAW_MARKER);
    }

    private void assertSendOfferInvariants() {
        assertApplicationState(
            SEND_OFFER_MARKER,
            ApplicationStatus.OFFER,
            1L
        );
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.offers offer
              ON offer.application_id = application.id
            WHERE application.job_title = ?
              AND offer.status = 'SENT'
              AND offer.version = 0
              AND offer.responded_at IS NULL
              AND offer.response_note IS NULL
            """,
            SEND_OFFER_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertHistoryAndOutbox(
            SEND_OFFER_MARKER,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            1L,
            "OFFER_SENT"
        );
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.offers offer
              ON offer.application_id = application.id
            JOIN application.application_event_outbox outbox
              ON outbox.aggregate_id = application.id
            WHERE application.job_title = ?
              AND outbox.payload::jsonb ->> 'offer_id' = offer.id::text
              AND outbox.payload::jsonb ->> 'offer_status' = 'SENT'
              AND outbox.payload::jsonb ->> 'offer_version' = '0'
            """,
            SEND_OFFER_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertGateAndUsage(SEND_OFFER_MARKER);
    }

    private void assertOfferResponseInvariants() {
        assertThat(applicationCount(RESPOND_OFFER_MARKER))
            .isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.offers offer
              ON offer.application_id = application.id
            WHERE application.job_title = ?
              AND application.version = 2
              AND offer.version = 1
              AND (
                    offer.status = 'ACCEPTED'
                AND application.status = 'HIRED'
                AND offer.responded_at IS NOT NULL
                AND offer.response_note IS NULL
                OR  offer.status = 'DECLINED'
                AND application.status = 'REJECTED'
                AND offer.responded_at IS NOT NULL
                AND BTRIM(offer.response_note) <> ''
              )
            """,
            RESPOND_OFFER_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.offers offer
              ON offer.application_id = application.id
            JOIN application.application_history history
              ON history.application_id = application.id
             AND history.from_status = 'OFFER'
             AND history.to_status = application.status
            JOIN application.application_event_outbox outbox
              ON outbox.aggregate_id = application.id
             AND outbox.payload::jsonb ->> 'to_status' = application.status
             AND outbox.payload::jsonb ->> 'aggregate_version' = '2'
             AND outbox.payload::jsonb ->> 'offer_id' = offer.id::text
             AND outbox.payload::jsonb ->> 'offer_status' = offer.status
             AND outbox.payload::jsonb ->> 'offer_version' = '1'
            WHERE application.job_title = ?
            """,
            RESPOND_OFFER_MARKER
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertExactlyOneHistoryAndOutbox(RESPOND_OFFER_MARKER);
        assertGateAndUsage(RESPOND_OFFER_MARKER);
    }

    private void assertApplicationState(
        String marker,
        ApplicationStatus status,
        long version
    ) {
        assertThat(applicationCount(marker)).isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications
            WHERE job_title = ? AND status = ? AND version = ?
            """,
            marker,
            status.name(),
            version
        )).isEqualTo(PAIRS_PER_WORKLOAD);
    }

    private void assertHistoryAndOutbox(
        String marker,
        ApplicationStatus fromStatus,
        ApplicationStatus toStatus,
        long aggregateVersion,
        String action
    ) {
        String fromPredicate = fromStatus == null
            ? "history.from_status IS NULL"
            : "history.from_status = '" + fromStatus.name() + "'";
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.application_history history
              ON history.application_id = application.id
            WHERE application.job_title = ?
              AND %s
              AND history.to_status = ?
            """.formatted(fromPredicate),
            marker,
            toStatus.name()
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.application_event_outbox outbox
              ON outbox.aggregate_id = application.id
            WHERE application.job_title = ?
              AND outbox.event_key = application.id
              AND outbox.topic = ?
              AND outbox.attempts = 0
              AND outbox.published_at IS NULL
              AND outbox.payload::jsonb ->> 'action' = ?
              AND outbox.payload::jsonb ->> 'to_status' = ?
              AND outbox.payload::jsonb ->> 'aggregate_version' = ?
            """,
            marker,
            TOPIC,
            action,
            toStatus.name(),
            Long.toString(aggregateVersion)
        )).isEqualTo(PAIRS_PER_WORKLOAD);
        assertExactlyOneHistoryAndOutbox(marker);
    }

    private void assertExactlyOneHistoryAndOutbox(String marker) {
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM (
                SELECT application.id
                FROM application.applications application
                LEFT JOIN application.application_history history
                  ON history.application_id = application.id
                LEFT JOIN application.application_event_outbox outbox
                  ON outbox.aggregate_id = application.id
                WHERE application.job_title = ?
                GROUP BY application.id
                HAVING COUNT(DISTINCT history.id) <> 1
                    OR COUNT(DISTINCT outbox.id) <> 1
            ) invalid
            """,
            marker
        )).isZero();
    }

    private void assertGateAndUsage(String marker) {
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.applications application
            JOIN application.cv_submission_gates gate
              ON gate.cv_id = application.cv_id
             AND gate.candidate_id = application.candidate_id
             AND gate.state = 'OPEN'
            JOIN application.application_cv_usage usage
              ON usage.cv_id = application.cv_id
             AND usage.candidate_id = application.candidate_id
             AND usage.application_count = 1
            WHERE application.job_title = ?
            """,
            marker
        )).isEqualTo(PAIRS_PER_WORKLOAD);
    }

    private void assertNoCrossWorkloadDatabaseCorruption(int measuredCalls) {
        assertThat(measuredCalls).isEqualTo(PAIRS_PER_WORKLOAD * 10);
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.application_history history
            LEFT JOIN application.applications application
              ON application.id = history.application_id
            WHERE application.id IS NULL
            """
        )).isZero();
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM application.application_event_outbox outbox
            LEFT JOIN application.applications application
              ON application.id = outbox.aggregate_id
            WHERE application.id IS NULL
            """
        )).isZero();
        assertThat(scalar(
            """
            SELECT COUNT(*)
            FROM (
                SELECT candidate_id, job_id
                FROM application.applications
                WHERE status IN (
                    'APPLIED', 'REVIEWING', 'INTERVIEW',
                    'OFFER', 'HIRED'
                )
                GROUP BY candidate_id, job_id
                HAVING COUNT(*) > 1
            ) duplicate
            """
        )).isZero();
    }

    private List<ApplicationFixture> insertApplications(
        String marker,
        ApplicationStatus status,
        long version
    ) {
        List<ApplicationFixture> fixtures = new ArrayList<>(
            PAIRS_PER_WORKLOAD
        );
        List<Object[]> arguments = new ArrayList<>(PAIRS_PER_WORKLOAD);
        for (int pair = 0; pair < PAIRS_PER_WORKLOAD; pair++) {
            ApplicationFixture fixture = new ApplicationFixture(
                pair,
                uuid(marker, pair, "application"),
                uuid(marker, pair, "job"),
                uuid(marker, pair, "candidate"),
                uuid(marker, pair, "cv")
            );
            fixtures.add(fixture);
            arguments.add(new Object[] {
                fixture.applicationId(),
                fixture.jobId(),
                COMPANY_ID,
                fixture.candidateId(),
                RECRUITER_ONE,
                fixture.cvId(),
                marker,
                "deterministic load-gate fixture " + pair,
                status.name(),
                Timestamp.from(FIXTURE_TIME),
                Timestamp.from(FIXTURE_TIME),
                version
            });
        }
        jdbc.batchUpdate(
            """
            INSERT INTO application.applications (
                id, job_id, company_id, candidate_id, recruiter_id, cv_id,
                job_title, cover_letter, status, source,
                applied_at, updated_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SEARCH', ?, ?, ?)
            """,
            arguments
        );
        return fixtures;
    }

    private void insertSentOffers(List<ApplicationFixture> fixtures) {
        List<Object[]> arguments = new ArrayList<>(fixtures.size());
        for (ApplicationFixture fixture : fixtures) {
            arguments.add(new Object[] {
                uuid(RESPOND_OFFER_MARKER, fixture.pair(), "offer"),
                fixture.applicationId(),
                RECRUITER_ONE,
                new BigDecimal("25000000.00"),
                java.sql.Date.valueOf(OFFER_START),
                "Backend Engineer",
                Timestamp.from(FIXTURE_TIME),
                Timestamp.from(OFFER_EXPIRY)
            });
        }
        jdbc.batchUpdate(
            """
            INSERT INTO application.offers (
                id, application_id, sent_by, salary, start_date, position,
                status, sent_at, expires_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, 'SENT', ?, ?, 0)
            """,
            arguments
        );
    }

    private CreateApplicationRequest submissionRequest(
        UUID jobId,
        UUID cvId
    ) {
        return new CreateApplicationRequest(
            jobId,
            cvId,
            "load-gate submission",
            ApplicationSource.SEARCH
        );
    }

    private CreateOfferRequest offerRequest(String sender) {
        return new CreateOfferRequest(
            new BigDecimal("25000000.00"),
            OFFER_START,
            "Backend Engineer",
            "offer from " + sender,
            null,
            null,
            OFFER_EXPIRY,
            0L
        );
    }

    private long applicationCount(String marker) {
        return scalar(
            "SELECT COUNT(*) FROM application.applications " +
                "WHERE job_title = ?",
            marker
        );
    }

    private long scalar(String sql, Object... arguments) {
        Long result = jdbc.queryForObject(sql, Long.class, arguments);
        if (result == null) {
            throw new AssertionError("COUNT query returned null");
        }
        return result;
    }

    private CallResult getBeforeDeadline(
        Future<CallResult> future,
        long deadline
    ) throws Exception {
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) throw new TimeoutException();
        return future.get(remaining, TimeUnit.NANOSECONDS);
    }

    private void assertLatencyThreshold(WorkloadMetrics metrics) {
        assertThat(metrics.p95Nanos())
            .as(
                "%s p95 must be at most %d ms",
                metrics.name(),
                P95_THRESHOLD_MS
            )
            .isLessThanOrEqualTo(
                TimeUnit.MILLISECONDS.toNanos(P95_THRESHOLD_MS)
            );
        assertThat(metrics.p99Nanos())
            .as(
                "%s p99 must be at most %d ms",
                metrics.name(),
                P99_THRESHOLD_MS
            )
            .isLessThanOrEqualTo(
                TimeUnit.MILLISECONDS.toNanos(P99_THRESHOLD_MS)
            );
        assertThat(metrics.maxNanos())
            .as(
                "%s max latency must be at most %d ms",
                metrics.name(),
                MAX_THRESHOLD_MS
            )
            .isLessThanOrEqualTo(
                TimeUnit.MILLISECONDS.toNanos(MAX_THRESHOLD_MS)
            );
        assertThat(metrics.requestsPerSecond())
            .as("%s throughput must be at least %d calls/s", metrics.name(), MIN_RPS)
            .isGreaterThanOrEqualTo((double) MIN_RPS);
    }

    private void printMetrics(WorkloadMetrics metrics) {
        System.out.printf(
            Locale.ROOT,
            "APPLICATION_CONCURRENCY_LOAD " +
                "workload=%s calls=%d successes=%d conflicts=%d " +
                "unexpected=%d server5xx=%d deadlocks=%d timeouts=%d " +
                "concurrency=%d p50_ms=%.3f p95_ms=%.3f " +
                "p99_ms=%.3f max_ms=%.3f rps=%.2f postgres=%s%n",
            metrics.name(),
            metrics.calls(),
            metrics.failures().successes(),
            metrics.failures().expectedConflicts(),
            metrics.failures().unexpected(),
            metrics.failures().serverErrors(),
            metrics.failures().deadlocks(),
            metrics.failures().timeouts(),
            CONCURRENCY,
            nanosToMillis(metrics.p50Nanos()),
            nanosToMillis(metrics.p95Nanos()),
            nanosToMillis(metrics.p99Nanos()),
            nanosToMillis(metrics.maxNanos()),
            metrics.requestsPerSecond(),
            POSTGRES_IMAGE
        );
    }

    private static double nanosToMillis(long nanos) {
        return nanos / 1_000_000.0;
    }

    private static boolean isTimeout(Throwable failure) {
        Throwable current = failure;
        while (current != null) {
            if (
                current instanceof TimeoutException ||
                current instanceof java.sql.SQLTimeoutException
            ) return true;
            if (current.getCause() == current) return false;
            current = current.getCause();
        }
        return false;
    }

    private static boolean isDeadlock(Throwable failure) {
        Throwable current = failure;
        while (current != null) {
            if (
                current instanceof SQLException sql &&
                "40P01".equals(sql.getSQLState())
            ) return true;
            if (current.getCause() == current) return false;
            current = current.getCause();
        }
        return false;
    }

    private static String describe(Throwable failure) {
        if (failure == null) return "none";
        if (failure instanceof BusinessException business) {
            return business.getClass().getSimpleName() + "[" +
                business.status().value() + "," + business.code() + "]";
        }
        return failure.getClass().getSimpleName() + "[" +
            failure.getMessage() + "]";
    }

    private static void addExample(List<String> examples, String value) {
        if (examples.size() < 5) examples.add(value);
    }

    private static UUID uuid(String workload, int pair, String role) {
        String seed = "application-concurrency-load:" + workload + ':' +
            pair + ':' + role;
        UUID named = UUID.nameUUIDFromBytes(
            seed.getBytes(StandardCharsets.UTF_8)
        );
        long versionFour = named.getMostSignificantBits() &
            0xffffffffffff0fffL | 0x0000000000004000L;
        long rfcVariant = named.getLeastSignificantBits() &
            0x3fffffffffffffffL | 0x8000000000000000L;
        return new UUID(versionFour, rfcVariant);
    }

    private static int boundedInt(
        String property,
        int defaultValue,
        int minimum,
        int maximum
    ) {
        long value = boundedLong(
            property,
            defaultValue,
            minimum,
            maximum
        );
        return Math.toIntExact(value);
    }

    private static long boundedLong(
        String property,
        long defaultValue,
        long minimum,
        long maximum
    ) {
        String configured = System.getProperty(property);
        if (configured == null || configured.isBlank()) return defaultValue;
        final long value;
        try {
            value = Long.parseLong(configured);
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException(
                property + " must be an integer",
                exception
            );
        }
        if (value < minimum || value > maximum) {
            throw new IllegalArgumentException(
                property + " must be between " + minimum + " and " +
                    maximum
            );
        }
        return value;
    }

    @FunctionalInterface
    private interface CheckedCall {
        Object call() throws Exception;
    }

    private record CallPair(CheckedCall first, CheckedCall second) {}

    private record CallResult(
        long latencyNanos,
        Object value,
        Throwable failure
    ) {
        boolean succeeded() {
            return failure == null;
        }
    }

    private record PairResult(CallResult first, CallResult second) {
        List<CallResult> calls() {
            return List.of(first, second);
        }

        String describe() {
            return calls().stream()
                .map(call -> call.succeeded()
                    ? "success:" + call.value().getClass().getSimpleName()
                    : "failure:" + ApplicationConcurrencyLoadGate.describe(
                        call.failure()
                    ))
                .toList()
                .toString();
        }
    }

    private record PairFutures(
        Future<CallResult> first,
        Future<CallResult> second
    ) {
        void cancel() {
            first.cancel(true);
            second.cancel(true);
        }
    }

    private record ApplicationFixture(
        int pair,
        UUID applicationId,
        UUID jobId,
        UUID candidateId,
        UUID cvId
    ) {}

    private record FailureSummary(
        int successes,
        int expectedConflicts,
        int unexpected,
        int serverErrors,
        int deadlocks,
        int timeouts
    ) {
        static FailureSummary total(List<WorkloadMetrics> metrics) {
            return new FailureSummary(
                metrics.stream()
                    .map(WorkloadMetrics::failures)
                    .mapToInt(FailureSummary::successes)
                    .sum(),
                metrics.stream()
                    .map(WorkloadMetrics::failures)
                    .mapToInt(FailureSummary::expectedConflicts)
                    .sum(),
                metrics.stream()
                    .map(WorkloadMetrics::failures)
                    .mapToInt(FailureSummary::unexpected)
                    .sum(),
                metrics.stream()
                    .map(WorkloadMetrics::failures)
                    .mapToInt(FailureSummary::serverErrors)
                    .sum(),
                metrics.stream()
                    .map(WorkloadMetrics::failures)
                    .mapToInt(FailureSummary::deadlocks)
                    .sum(),
                metrics.stream()
                    .map(WorkloadMetrics::failures)
                    .mapToInt(FailureSummary::timeouts)
                    .sum()
            );
        }
    }

    private record WorkloadMetrics(
        String name,
        int calls,
        long elapsedNanos,
        long p50Nanos,
        long p95Nanos,
        long p99Nanos,
        long maxNanos,
        FailureSummary failures,
        List<Long> latencies
    ) {
        static WorkloadMetrics of(
            String name,
            List<Long> rawLatencies,
            long elapsedNanos,
            FailureSummary failures
        ) {
            List<Long> sorted = rawLatencies.stream()
                .sorted(Comparator.naturalOrder())
                .toList();
            return new WorkloadMetrics(
                name,
                sorted.size(),
                elapsedNanos,
                percentile(sorted, 0.50),
                percentile(sorted, 0.95),
                percentile(sorted, 0.99),
                sorted.getLast(),
                failures,
                sorted
            );
        }

        static WorkloadMetrics total(List<WorkloadMetrics> metrics) {
            List<Long> latencies = metrics.stream()
                .flatMap(metric -> metric.latencies().stream())
                .toList();
            return of(
                "total",
                latencies,
                metrics.stream()
                    .mapToLong(WorkloadMetrics::elapsedNanos)
                    .sum(),
                FailureSummary.total(metrics)
            );
        }

        double requestsPerSecond() {
            return calls / (elapsedNanos / 1_000_000_000.0);
        }

        private static long percentile(List<Long> sorted, double percentile) {
            int index = (int) Math.ceil(sorted.size() * percentile) - 1;
            return sorted.get(Math.max(0, index));
        }
    }

    @TestConfiguration
    static class JacksonConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper().findAndRegisterModules();
        }
    }
}
