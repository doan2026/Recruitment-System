package com.recruitment.application.pipeline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.ApplicationHistoryRepository;
import com.recruitment.application.repository.ApplicationRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
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
    ApplicationPipelineService.class,
    ApplicationHistoryWriter.class,
    ApplicationPipelinePostgresIT.TestJacksonConfiguration.class
})
class ApplicationPipelinePostgresIT {
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000002"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID SECOND_RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000002"
    );
    private static final UUID OUTSIDE_RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000003"
    );
    private static final UUID OWNER_JOB_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final UUID MEMBER_JOB_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000002"
    );
    private static final UUID OTHER_COMPANY_JOB_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000003"
    );
    private static final String AUTHORIZATION = "Bearer integration-test";
    private static final String OUTBOX_TOPIC_CONSTRAINT =
        "application_event_outbox_test_topic_check";

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
    private ApplicationPipelineService pipeline;

    @Autowired
    private ApplicationPipelineRepository pipelineRepository;

    @Autowired
    private ApplicationRepository applicationRepository;

    @Autowired
    private ApplicationHistoryRepository historyRepository;

    @Autowired
    private ApplicationEventOutboxRepository outboxRepository;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockBean
    private CompanyClient companies;

    private ExecutorService executor;

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
                application.applications
            CASCADE
            """
        );
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
        when(companies.getRecruiterMembership(
            SECOND_RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
    }

    @AfterEach
    void tearDown() throws InterruptedException {
        if (executor == null) {
            return;
        }
        executor.shutdownNow();
        assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    void flywayCreatesAndValidatesTheApplicationSchema() {
        List<String> appliedVersions = jdbc.queryForList(
            """
            SELECT version
            FROM application.flyway_schema_history
            WHERE success AND version IS NOT NULL
            ORDER BY installed_rank
            """,
            String.class
        );
        List<String> tables = jdbc.queryForList(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'application'
            ORDER BY table_name
            """,
            String.class
        );

        assertThat(appliedVersions).containsExactly("1", "2", "3", "4");
        assertThat(tables).contains(
            "applications",
            "application_history",
            "application_event_outbox",
            "bookmarks",
            "evaluations",
            "offers"
        );
    }

    @Test
    void statusTransitionCommitsApplicationHistoryAndOutboxTogether() {
        UUID applicationId = saveAppliedApplication();

        StatusTransitionResponse response = pipeline.changeStatus(
            applicationId,
            RECRUITER_ID,
            AUTHORIZATION,
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REVIEWING,
                "  Strong backend experience  ",
                0L
            )
        );

        ApplicationEntity updated = applicationRepository
            .findById(applicationId)
            .orElseThrow();
        Map<String, Object> history = jdbc.queryForMap(
            """
            SELECT from_status, to_status, changed_by, note
            FROM application.application_history
            WHERE application_id = ?
            """,
            applicationId
        );
        Map<String, Object> outbox = jdbc.queryForMap(
            """
            SELECT aggregate_id, event_key, topic, payload, published_at
            FROM application.application_event_outbox
            WHERE aggregate_id = ?
            """,
            applicationId
        );

        assertThat(response.fromStatus()).isEqualTo(ApplicationStatus.APPLIED);
        assertThat(response.toStatus()).isEqualTo(ApplicationStatus.REVIEWING);
        assertThat(response.version()).isEqualTo(1L);
        assertThat(updated.getStatus()).isEqualTo(ApplicationStatus.REVIEWING);
        assertThat(updated.getVersion()).isEqualTo(1L);

        assertThat(history)
            .containsEntry("from_status", "APPLIED")
            .containsEntry("to_status", "REVIEWING")
            .containsEntry("changed_by", RECRUITER_ID)
            .containsEntry("note", "Strong backend experience");
        assertThat(outbox)
            .containsEntry("aggregate_id", applicationId)
            .containsEntry("event_key", applicationId)
            .containsEntry("topic", "application-events")
            .containsEntry("published_at", null);
        assertThat((String) outbox.get("payload"))
            .contains("\"action\":\"STATUS_CHANGED\"")
            .contains("\"application_id\":\"" + applicationId + "\"")
            .contains("\"to_status\":\"REVIEWING\"");
    }

    @Test
    void memberAndOwnerHaveCompanyWideAccessButOutsiderIsDenied() {
        UUID ownerJobApplication = saveAppliedApplication(
            OWNER_JOB_ID,
            COMPANY_ID,
            SECOND_RECRUITER_ID,
            Instant.parse("2026-08-24T00:00:00Z")
        );
        UUID memberJobApplication = saveAppliedApplication(
            MEMBER_JOB_ID,
            COMPANY_ID,
            RECRUITER_ID,
            Instant.parse("2026-08-24T01:00:00Z")
        );
        UUID otherCompanyApplication = saveAppliedApplication(
            OTHER_COMPANY_JOB_ID,
            OTHER_COMPANY_ID,
            OUTSIDE_RECRUITER_ID,
            Instant.parse("2026-08-24T02:00:00Z")
        );
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
        when(companies.getRecruiterMembership(
            SECOND_RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.OWNER
        ));
        when(companies.getRecruiterMembership(
            OUTSIDE_RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            OTHER_COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));

        RecruiterApplicationPageResponse memberPage =
            pipeline.listForRecruiter(
                RECRUITER_ID,
                AUTHORIZATION,
                null,
                null,
                null,
                null,
                ApplicationSort.APPLIED_AT_DESC,
                0,
                20
            );
        RecruiterApplicationPageResponse ownerPage =
            pipeline.listForRecruiter(
                SECOND_RECRUITER_ID,
                AUTHORIZATION,
                null,
                null,
                null,
                null,
                ApplicationSort.APPLIED_AT_DESC,
                0,
                20
            );
        RecruiterApplicationPageResponse memberOwnerJobPage =
            pipeline.listForRecruiter(
                RECRUITER_ID,
                AUTHORIZATION,
                OWNER_JOB_ID,
                null,
                null,
                null,
                ApplicationSort.APPLIED_AT_DESC,
                0,
                20
            );

        assertThat(memberPage.items())
            .extracting(RecruiterApplicationItemResponse::id)
            .containsExactly(memberJobApplication, ownerJobApplication);
        assertThat(ownerPage.items())
            .extracting(RecruiterApplicationItemResponse::id)
            .containsExactly(memberJobApplication, ownerJobApplication);
        assertThat(memberPage.items())
            .extracting(RecruiterApplicationItemResponse::id)
            .doesNotContain(otherCompanyApplication);
        assertThat(memberOwnerJobPage.items())
            .extracting(RecruiterApplicationItemResponse::id)
            .containsExactly(ownerJobApplication);

        StatusTransitionResponse memberTransition = pipeline.changeStatus(
            ownerJobApplication,
            RECRUITER_ID,
            AUTHORIZATION,
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REVIEWING,
                "Member reviewed an owner's job",
                0L
            )
        );
        StatusTransitionResponse ownerTransition = pipeline.changeStatus(
            memberJobApplication,
            SECOND_RECRUITER_ID,
            AUTHORIZATION,
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REVIEWING,
                "Owner reviewed a member's job",
                0L
            )
        );

        assertThat(memberTransition.toStatus())
            .isEqualTo(ApplicationStatus.REVIEWING);
        assertThat(ownerTransition.toStatus())
            .isEqualTo(ApplicationStatus.REVIEWING);
        assertThatThrownBy(() -> pipeline.changeStatus(
            ownerJobApplication,
            OUTSIDE_RECRUITER_ID,
            AUTHORIZATION,
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REJECTED,
                "Not authorized",
                1L
            )
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_ACCESS_DENIED");
        assertThat(historyRepository.count()).isEqualTo(2L);
        assertThat(outboxRepository.count()).isEqualTo(2L);
        assertThat(applicationRepository.findById(ownerJobApplication))
            .get()
            .extracting(ApplicationEntity::getStatus)
            .isEqualTo(ApplicationStatus.REVIEWING);
        assertThat(applicationRepository.findById(otherCompanyApplication))
            .get()
            .extracting(ApplicationEntity::getStatus)
            .isEqualTo(ApplicationStatus.APPLIED);
        verify(companies, atLeastOnce()).getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        );
        verify(companies, atLeastOnce()).getRecruiterMembership(
            SECOND_RECRUITER_ID,
            AUTHORIZATION
        );
        verify(companies).getRecruiterMembership(
            OUTSIDE_RECRUITER_ID,
            AUTHORIZATION
        );
    }

    @Test
    void outboxFailureRollsBackStatusAndHistory() {
        UUID applicationId = saveAppliedApplication();
        jdbc.execute(
            """
            ALTER TABLE application.application_event_outbox
            ADD CONSTRAINT application_event_outbox_test_topic_check
            CHECK (topic <> 'application-events')
            """
        );

        try {
            assertThatThrownBy(() -> pipeline.changeStatus(
                applicationId,
                RECRUITER_ID,
                AUTHORIZATION,
                new ChangeApplicationStatusRequest(
                    ApplicationStatus.REVIEWING,
                    "Ready for review",
                    0L
                )
            )).isInstanceOf(DataIntegrityViolationException.class);
        } finally {
            jdbc.execute(
                "ALTER TABLE application.application_event_outbox " +
                    "DROP CONSTRAINT IF EXISTS " + OUTBOX_TOPIC_CONSTRAINT
            );
        }

        ApplicationEntity unchanged = applicationRepository
            .findById(applicationId)
            .orElseThrow();
        assertThat(unchanged.getStatus()).isEqualTo(ApplicationStatus.APPLIED);
        assertThat(unchanged.getVersion()).isZero();
        assertThat(historyRepository.count()).isZero();
        assertThat(outboxRepository.count()).isZero();
    }

    @Test
    void atomicVersionUpdateAllowsExactlyOneWinner() throws Exception {
        UUID applicationId = saveAppliedApplication();
        CountDownLatch transactionsReady = new CountDownLatch(2);
        CountDownLatch startUpdates = new CountDownLatch(1);
        TransactionTemplate transaction = new TransactionTemplate(
            transactionManager
        );
        executor = Executors.newFixedThreadPool(2);

        Future<Integer> first = executor.submit(() -> transitionWhenReleased(
            transaction,
            transactionsReady,
            startUpdates,
            applicationId
        ));
        Future<Integer> second = executor.submit(() -> transitionWhenReleased(
            transaction,
            transactionsReady,
            startUpdates,
            applicationId
        ));

        assertThat(transactionsReady.await(5, TimeUnit.SECONDS)).isTrue();
        startUpdates.countDown();

        assertThat(List.of(
            first.get(10, TimeUnit.SECONDS),
            second.get(10, TimeUnit.SECONDS)
        )).containsExactlyInAnyOrder(0, 1);

        ApplicationEntity updated = applicationRepository
            .findById(applicationId)
            .orElseThrow();
        assertThat(updated.getVersion()).isEqualTo(1L);
        assertThat(updated.getStatus()).isEqualTo(ApplicationStatus.REVIEWING);
    }

    @Test
    void twoRecruitersProduceOneSuccessAndOneConflict() throws Exception {
        UUID applicationId = saveAppliedApplication();
        CountDownLatch callersReady = new CountDownLatch(2);
        CountDownLatch startCalls = new CountDownLatch(1);
        executor = Executors.newFixedThreadPool(2);

        Future<Object> first = executor.submit(() -> changeWhenReleased(
            callersReady,
            startCalls,
            applicationId,
            RECRUITER_ID
        ));
        Future<Object> second = executor.submit(() -> changeWhenReleased(
            callersReady,
            startCalls,
            applicationId,
            SECOND_RECRUITER_ID
        ));

        assertThat(callersReady.await(5, TimeUnit.SECONDS)).isTrue();
        startCalls.countDown();

        List<Object> outcomes = List.of(
            first.get(10, TimeUnit.SECONDS),
            second.get(10, TimeUnit.SECONDS)
        );
        long successes = outcomes.stream()
            .filter(StatusTransitionResponse.class::isInstance)
            .count();
        List<BusinessException> conflicts = outcomes.stream()
            .filter(BusinessException.class::isInstance)
            .map(BusinessException.class::cast)
            .toList();

        assertThat(successes).isEqualTo(1L);
        assertThat(conflicts).singleElement().satisfies(conflict -> {
            assertThat(conflict.code())
                .isEqualTo("APPLICATION_CHANGED_CONCURRENTLY");
            assertThat(conflict.status()).isEqualTo(HttpStatus.CONFLICT);
        });

        ApplicationEntity updated = applicationRepository
            .findById(applicationId)
            .orElseThrow();
        assertThat(updated.getStatus()).isEqualTo(ApplicationStatus.REVIEWING);
        assertThat(updated.getVersion()).isEqualTo(1L);
        assertThat(historyRepository.count()).isEqualTo(1L);
        assertThat(outboxRepository.count()).isEqualTo(1L);
    }

    private int transitionWhenReleased(
        TransactionTemplate transaction,
        CountDownLatch transactionsReady,
        CountDownLatch startUpdates,
        UUID applicationId
    ) {
        Integer changed = transaction.execute(status -> {
            transactionsReady.countDown();
            await(startUpdates);
            return pipelineRepository.transition(
                applicationId,
                ApplicationStatus.REVIEWING,
                Instant.now(),
                0L
            );
        });
        return changed == null ? 0 : changed;
    }

    private Object changeWhenReleased(
        CountDownLatch callersReady,
        CountDownLatch startCalls,
        UUID applicationId,
        UUID recruiterId
    ) {
        callersReady.countDown();
        await(startCalls);
        try {
            return pipeline.changeStatus(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                new ChangeApplicationStatusRequest(
                    ApplicationStatus.REVIEWING,
                    "Concurrent review",
                    0L
                )
            );
        } catch (BusinessException exception) {
            return exception;
        }
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException(
                    "Timed out while coordinating concurrent updates"
                );
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                "Interrupted while coordinating concurrent updates",
                exception
            );
        }
    }

    private UUID saveAppliedApplication() {
        return saveAppliedApplication(
            UUID.randomUUID(),
            COMPANY_ID,
            RECRUITER_ID,
            Instant.parse("2026-08-24T00:00:00Z")
        );
    }

    private UUID saveAppliedApplication(
        UUID jobId,
        UUID companyId,
        UUID jobOwnerRecruiterId,
        Instant appliedAt
    ) {
        UUID applicationId = UUID.randomUUID();
        applicationRepository.saveAndFlush(ApplicationEntity.applied(
            applicationId,
            jobId,
            companyId,
            UUID.randomUUID(),
            jobOwnerRecruiterId,
            UUID.randomUUID(),
            "Backend Engineer",
            "I would like to apply",
            ApplicationSource.SEARCH,
            appliedAt
        ));
        return applicationId;
    }

    @TestConfiguration
    static class TestJacksonConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper().findAndRegisterModules();
        }
    }
}
