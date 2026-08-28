package com.recruitment.application.usage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.repository.ApplicationRepository;
import com.recruitment.application.submission.CvSubmissionGateService;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import org.junit.jupiter.api.AfterEach;
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
@Import({
    CvDeletionFenceService.class,
    CvSubmissionGateService.class,
    CvUsageLookupService.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class CvDeletionFencePostgresIT {
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000001"
    );
    private static final UUID OTHER_CANDIDATE_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000002"
    );
    private static final UUID CV_ID = UUID.fromString(
        "20000000-0000-4000-8000-000000000001"
    );
    private static final UUID DELETION_REQUEST_ID = UUID.fromString(
        "30000000-0000-4000-8000-000000000001"
    );
    private static final Instant APPLIED_AT = Instant.parse(
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
    private ApplicationRepository applications;

    @Autowired
    private CvDeletionFenceService fences;

    @Autowired
    private CvSubmissionGateService submissionGates;

    @Autowired
    private CvUsageLookupService usages;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private ExecutorService executor;

    @BeforeEach
    void cleanDatabase() {
        jdbc.execute(
            "TRUNCATE TABLE application.applications, " +
                "application.application_cv_usage, " +
                "application.cv_submission_gates CASCADE"
        );
    }

    @AfterEach
    void stopExecutor() {
        if (executor != null) executor.shutdownNow();
    }

    @Test
    void unusedFenceIsPermanentIdempotentAndRejectsFutureApplications() {
        CvDeletionFenceRequest request = request(
            CV_ID,
            DELETION_REQUEST_ID
        );

        CvDeletionFenceResponse first = fences.acquire(request);
        CvDeletionFenceResponse replay = fences.acquire(request);

        assertThat(first.disposition())
            .isEqualTo(CvDeletionFenceDisposition.FENCED);
        assertThat(first.fencedAt()).isNotNull();
        assertThat(first.firstUsedAt()).isNull();
        assertThat(first.applicationCount()).isZero();
        assertThat(replay).isEqualTo(first);

        Map<String, Object> gate = jdbc.queryForMap(
            "SELECT candidate_id, state, deletion_request_id, fenced_at " +
                "FROM application.cv_submission_gates WHERE cv_id = ?",
            CV_ID
        );
        assertThat(gate.get("candidate_id")).isEqualTo(CANDIDATE_ID);
        assertThat(gate.get("state")).isEqualTo("DELETE_FENCED");
        assertThat(gate.get("deletion_request_id"))
            .isEqualTo(DELETION_REQUEST_ID);

        assertBusinessCode(
            () -> fences.acquire(request(CV_ID, UUID.randomUUID())),
            "CV_DELETION_FENCE_CONFLICT"
        );
        assertThatThrownBy(() -> applications.saveAndFlush(application(
            CANDIDATE_ID,
            CV_ID,
            APPLIED_AT
        ))).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(usageCount(CV_ID)).isZero();

        assertThatThrownBy(() -> jdbc.update(
            "UPDATE application.cv_submission_gates " +
                "SET state = 'OPEN', deletion_request_id = NULL, " +
                "fenced_at = NULL WHERE cv_id = ?",
            CV_ID
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(
            "DELETE FROM application.cv_submission_gates WHERE cv_id = ?",
            CV_ID
        )).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void usedCvReturnsAuthoritativeUsageAndRemainsOpen() {
        applications.saveAndFlush(application(
            CANDIDATE_ID,
            CV_ID,
            APPLIED_AT
        ));

        CvDeletionFenceResponse result = fences.acquire(request(
            CV_ID,
            DELETION_REQUEST_ID
        ));

        assertThat(result.disposition())
            .isEqualTo(CvDeletionFenceDisposition.USED);
        assertThat(result.fencedAt()).isNull();
        assertThat(result.firstUsedAt()).isEqualTo(APPLIED_AT);
        assertThat(result.applicationCount()).isEqualTo(1);
        assertThat(gateState(CV_ID)).isEqualTo("OPEN");

        CvUsageLookupResponse legacyLookup = usages.lookup(
            new CvUsageLookupRequest(CANDIDATE_ID, CV_ID)
        );
        assertThat(legacyLookup.used()).isTrue();
        assertThat(legacyLookup.firstUsedAt()).isEqualTo(APPLIED_AT);
        assertBusinessCode(
            () -> fences.acquire(new CvDeletionFenceRequest(
                OTHER_CANDIDATE_ID,
                CV_ID,
                UUID.randomUUID()
            )),
            "CV_USAGE_OWNER_MISMATCH"
        );
    }

    @Test
    void unsafeJsonUsageCountFailsClosedOnBothInternalContracts() {
        applications.saveAndFlush(application(
            CANDIDATE_ID,
            CV_ID,
            APPLIED_AT
        ));
        jdbc.update(
            "UPDATE application.application_cv_usage " +
                "SET application_count = 9007199254740992 " +
                "WHERE cv_id = ?",
            CV_ID
        );

        assertBusinessCode(
            () -> fences.acquire(request(CV_ID, DELETION_REQUEST_ID)),
            "CV_DELETION_FENCE_INVALID_STATE"
        );
        assertBusinessCode(
            () -> usages.lookup(new CvUsageLookupRequest(
                CANDIDATE_ID,
                CV_ID
            )),
            "CV_USAGE_INVALID_STATE"
        );
        assertThat(gateState(CV_ID)).isEqualTo("OPEN");
    }

    @Test
    void deletionRequestCannotFenceTwoDifferentCvs() {
        fences.acquire(request(CV_ID, DELETION_REQUEST_ID));

        assertBusinessCode(
            () -> fences.acquire(request(
                UUID.randomUUID(),
                DELETION_REQUEST_ID
            )),
            "CV_DELETION_FENCE_CONFLICT"
        );
    }

    @Test
    void rolledBackSubmissionLeavesNoUsageAndCanBeFenced() {
        assertThatThrownBy(() -> transaction().executeWithoutResult(status -> {
            submissionGates.lockForSubmission(CANDIDATE_ID, CV_ID);
            applications.saveAndFlush(application(
                CANDIDATE_ID,
                CV_ID,
                APPLIED_AT
            ));
            throw new IllegalStateException("force rollback");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(applicationCount(CV_ID)).isZero();
        assertThat(usageCount(CV_ID)).isZero();
        assertThat(gateCount(CV_ID)).isZero();
        assertThat(fences.acquire(request(CV_ID, DELETION_REQUEST_ID))
            .disposition()).isEqualTo(CvDeletionFenceDisposition.FENCED);
    }

    @Test
    void committedSubmissionWinsAgainstConcurrentFence() throws Exception {
        executor = Executors.newFixedThreadPool(2);
        CountDownLatch gateLocked = new CountDownLatch(1);
        CountDownLatch releaseSubmission = new CountDownLatch(1);

        Future<?> submission = executor.submit(() ->
            transaction().executeWithoutResult(status -> {
                submissionGates.lockForSubmission(CANDIDATE_ID, CV_ID);
                gateLocked.countDown();
                await(releaseSubmission);
                applications.saveAndFlush(application(
                    CANDIDATE_ID,
                    CV_ID,
                    APPLIED_AT
                ));
            })
        );
        assertThat(gateLocked.await(5, TimeUnit.SECONDS)).isTrue();

        Future<CvDeletionFenceResponse> fence = executor.submit(() ->
            fences.acquire(request(CV_ID, DELETION_REQUEST_ID))
        );
        try {
            assertThat(waitForBlockedTransaction()).isTrue();
        } finally {
            releaseSubmission.countDown();
        }

        submission.get(10, TimeUnit.SECONDS);
        CvDeletionFenceResponse result = fence.get(10, TimeUnit.SECONDS);
        assertThat(result.disposition())
            .isEqualTo(CvDeletionFenceDisposition.USED);
        assertThat(result.applicationCount()).isEqualTo(1);
        assertThat(gateState(CV_ID)).isEqualTo("OPEN");
    }

    @Test
    void committedFenceWinsAgainstConcurrentSubmission() throws Exception {
        executor = Executors.newFixedThreadPool(2);
        CountDownLatch fenceWritten = new CountDownLatch(1);
        CountDownLatch releaseFence = new CountDownLatch(1);

        Future<CvDeletionFenceResponse> fence = executor.submit(() ->
            transaction().execute(status -> {
                CvDeletionFenceResponse result = fences.acquire(request(
                    CV_ID,
                    DELETION_REQUEST_ID
                ));
                fenceWritten.countDown();
                await(releaseFence);
                return result;
            })
        );
        assertThat(fenceWritten.await(5, TimeUnit.SECONDS)).isTrue();

        Future<Object> submission = executor.submit(() -> {
            try {
                transaction().executeWithoutResult(status -> {
                    submissionGates.lockForSubmission(CANDIDATE_ID, CV_ID);
                    applications.saveAndFlush(application(
                        CANDIDATE_ID,
                        CV_ID,
                        APPLIED_AT
                    ));
                });
                return "SUBMITTED";
            } catch (RuntimeException exception) {
                return exception;
            }
        });
        try {
            assertThat(waitForBlockedTransaction()).isTrue();
        } finally {
            releaseFence.countDown();
        }

        assertThat(fence.get(10, TimeUnit.SECONDS).disposition())
            .isEqualTo(CvDeletionFenceDisposition.FENCED);
        Object submissionResult = submission.get(10, TimeUnit.SECONDS);
        assertThat(submissionResult).isInstanceOf(BusinessException.class);
        assertThat(((BusinessException) submissionResult).code())
            .isEqualTo("CV_NOT_AVAILABLE");
        assertThat(applicationCount(CV_ID)).isZero();
        assertThat(usageCount(CV_ID)).isZero();
        assertThat(gateState(CV_ID)).isEqualTo("DELETE_FENCED");
    }

    private TransactionTemplate transaction() {
        return new TransactionTemplate(transactionManager);
    }

    private CvDeletionFenceRequest request(
        UUID cvId,
        UUID deletionRequestId
    ) {
        return new CvDeletionFenceRequest(
            CANDIDATE_ID,
            cvId,
            deletionRequestId
        );
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

    private void assertBusinessCode(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
        String code
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> assertThat(((BusinessException) error).code())
                .isEqualTo(code));
    }

    private long applicationCount(UUID cvId) {
        return jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.applications WHERE cv_id = ?",
            Long.class,
            cvId
        );
    }

    private long usageCount(UUID cvId) {
        return jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.application_cv_usage " +
                "WHERE cv_id = ?",
            Long.class,
            cvId
        );
    }

    private long gateCount(UUID cvId) {
        return jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.cv_submission_gates " +
                "WHERE cv_id = ?",
            Long.class,
            cvId
        );
    }

    private String gateState(UUID cvId) {
        return jdbc.queryForObject(
            "SELECT state FROM application.cv_submission_gates " +
                "WHERE cv_id = ?",
            String.class,
            cvId
        );
    }

    private boolean waitForBlockedTransaction() {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        do {
            Boolean waiting = jdbc.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_locks
                    WHERE NOT granted
                      AND pid <> pg_backend_pid()
                )
                """,
                Boolean.class
            );
            if (Boolean.TRUE.equals(waiting)) return true;
            LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(10));
        } while (System.nanoTime() < deadline);
        return false;
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException(
                    "Timed out while coordinating CV fence transactions"
                );
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                "Interrupted while coordinating CV fence transactions",
                exception
            );
        }
    }
}
