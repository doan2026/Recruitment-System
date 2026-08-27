package com.recruitment.application.offer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.domain.OfferEntity;
import com.recruitment.application.domain.OfferStatus;
import com.recruitment.application.pipeline.ApplicationHistoryWriter;
import com.recruitment.application.pipeline.ApplicationPipelineRepository;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.ApplicationHistoryRepository;
import com.recruitment.application.repository.OfferRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
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
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
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
    ApplicationHistoryWriter.class,
    ApplicationOfferPostgresIT.TestOfferConfiguration.class
})
class ApplicationOfferPostgresIT {
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID JOB_OWNER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000002"
    );
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_CANDIDATE_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000002"
    );
    private static final UUID FILE_ID = UUID.fromString(
        "40000000-0000-0000-0000-000000000001"
    );
    private static final Instant NOW = Instant.parse(
        "2026-08-25T08:30:00Z"
    );
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final String TOPIC = "application-events";
    private static final String AUTHORIZATION = "Bearer offer-integration";
    private static final String OUTBOX_TOPIC_CONSTRAINT =
        "application_offer_test_topic_check";
    private static final String APPLICATION_STATUS_CONSTRAINT =
        "application_offer_test_status_check";

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
    private JdbcTemplate jdbc;

    @Autowired
    private ApplicationOfferService service;

    @Autowired
    private ApplicationPipelineRepository applications;

    @Autowired
    private OfferRepository offers;

    @Autowired
    private ApplicationHistoryRepository history;

    @Autowired
    private ApplicationEventOutboxRepository outbox;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private CompanyClient companies;

    private ExecutorService executor;

    @BeforeEach
    void setUp() {
        jdbc.execute(
            "ALTER TABLE application.applications " +
                "DROP CONSTRAINT IF EXISTS " + APPLICATION_STATUS_CONSTRAINT
        );
        jdbc.execute(
            "ALTER TABLE application.application_event_outbox " +
                "DROP CONSTRAINT IF EXISTS " + OUTBOX_TOPIC_CONSTRAINT
        );
        jdbc.execute(
            """
            TRUNCATE TABLE
                application.offers,
                application.evaluations,
                application.application_event_outbox,
                application.application_history,
                application.bookmarks,
                application.application_cv_usage,
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
    void flywayV4CreatesTheOfferSchemaConstraintsAndPendingExpiryIndex() {
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
        Map<String, String> columnTypes = jdbc.query(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'application'
              AND table_name = 'offers'
              AND column_name IN (
                  'salary', 'start_date', 'file_id',
                  'sent_at', 'expires_at', 'responded_at', 'version'
              )
            """,
            result -> {
                Map<String, String> types = new HashMap<>();
                while (result.next()) {
                    types.put(result.getString(1), result.getString(2));
                }
                return types;
            }
        );
        List<String> constraints = jdbc.queryForList(
            """
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = 'application'
              AND table_name = 'offers'
            """,
            String.class
        );
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

        assertThat(appliedVersions).containsExactly("1", "2", "3", "4", "5", "6");
        assertThat(tables).contains("offers");
        assertThat(columnTypes)
            .containsEntry("salary", "numeric")
            .containsEntry("start_date", "date")
            .containsEntry("file_id", "uuid")
            .containsEntry("sent_at", "timestamp with time zone")
            .containsEntry("expires_at", "timestamp with time zone")
            .containsEntry("responded_at", "timestamp with time zone")
            .containsEntry("version", "bigint");
        assertThat(constraints).contains(
            "offers_application_unique",
            "offers_salary_positive_check",
            "offers_position_non_blank_check",
            "offers_expiry_after_sent_check",
            "offers_file_pair_check",
            "offers_status_check",
            "offers_response_coherence_check"
        );
        assertThat(pendingExpiryIndex)
            .contains("expires_at")
            .contains("WHERE")
            .contains("'SENT'");
    }

    @Test
    void sendCommitsInterviewOfferHistoryAndOfferSentOutboxTogether()
        throws Exception {
        UUID applicationId = saveApplication(
            ApplicationStatus.INTERVIEW,
            0L
        );

        OfferResponse response = sendOffer(applicationId);

        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow();
        OfferEntity offer = offers.findByApplicationId(applicationId)
            .orElseThrow();
        Map<String, Object> persistedHistory = jdbc.queryForMap(
            """
            SELECT from_status, to_status, changed_by, note, changed_at
            FROM application.application_history
            WHERE application_id = ?
            """,
            applicationId
        );
        Map<String, Object> persistedOutbox = jdbc.queryForMap(
            """
            SELECT aggregate_id, event_key, topic, payload, published_at
            FROM application.application_event_outbox
            WHERE aggregate_id = ?
            """,
            applicationId
        );
        JsonNode payload = objectMapper.readTree(
            (String) persistedOutbox.get("payload")
        );

        assertThat(response.id()).isEqualTo(offer.getId());
        assertThat(response.applicationStatus())
            .isEqualTo(ApplicationStatus.OFFER);
        assertThat(response.applicationVersion()).isEqualTo(1L);
        assertThat(application.getStatus()).isEqualTo(ApplicationStatus.OFFER);
        assertThat(application.getVersion()).isEqualTo(1L);
        assertThat(offer.getApplicationId()).isEqualTo(applicationId);
        assertThat(offer.getSentBy()).isEqualTo(RECRUITER_ID);
        assertThat(offer.getSalary()).isEqualByComparingTo("25000000.00");
        assertThat(offer.getStartDate()).isEqualTo(LocalDate.of(2026, 9, 15));
        assertThat(offer.getPosition()).isEqualTo("Senior Backend Engineer");
        assertThat(offer.getNote()).isEqualTo("Welcome aboard");
        assertThat(offer.getFileId()).isEqualTo(FILE_ID);
        assertThat(offer.getFileUrl())
            .isEqualTo("https://files.example.test/offers/offer.pdf");
        assertThat(offer.getStatus()).isEqualTo(OfferStatus.SENT);
        assertThat(offer.getSentAt()).isEqualTo(NOW);
        assertThat(offer.getExpiresAt())
            .isEqualTo(Instant.parse("2026-09-05T17:00:00Z"));
        assertThat(offer.getVersion()).isZero();

        assertThat(persistedHistory)
            .containsEntry("from_status", "INTERVIEW")
            .containsEntry("to_status", "OFFER")
            .containsEntry("changed_by", RECRUITER_ID)
            .containsEntry("note", "Welcome aboard");
        assertThat(persistedOutbox)
            .containsEntry("aggregate_id", applicationId)
            .containsEntry("event_key", applicationId)
            .containsEntry("topic", TOPIC)
            .containsEntry("published_at", null);
        assertThat(payload.path("action").asText()).isEqualTo("OFFER_SENT");
        assertThat(payload.path("application_id").asText())
            .isEqualTo(applicationId.toString());
        assertThat(payload.path("recruiter_id").asText())
            .isEqualTo(JOB_OWNER_ID.toString());
        assertThat(payload.path("actor_id").asText())
            .isEqualTo(RECRUITER_ID.toString());
        assertThat(payload.path("from_status").asText())
            .isEqualTo("INTERVIEW");
        assertThat(payload.path("to_status").asText()).isEqualTo("OFFER");
        assertThat(payload.path("offer_id").asText())
            .isEqualTo(offer.getId().toString());
        assertThat(payload.path("offer_status").asText()).isEqualTo("SENT");
        assertThat(payload.path("offer_version").asLong()).isZero();
    }

    @Test
    void acceptCommitsOfferAndApplicationAsHiredWithHistoryAndOutbox()
        throws Exception {
        UUID applicationId = saveApplication(
            ApplicationStatus.INTERVIEW,
            0L
        );
        OfferResponse sent = sendOffer(applicationId);

        OfferResponse accepted = service.respond(
            sent.id(),
            CANDIDATE_ID,
            new RespondOfferRequest(
                OfferDecision.ACCEPTED,
                "ignored for acceptance",
                0L,
                1L
            )
        );

        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow();
        OfferEntity offer = offers.findById(sent.id()).orElseThrow();
        Map<String, Object> acceptedHistory = transitionHistory(
            applicationId,
            ApplicationStatus.HIRED
        );
        JsonNode acceptedEvent = responseEvent(applicationId);

        assertThat(accepted.status()).isEqualTo(OfferStatus.ACCEPTED);
        assertThat(accepted.responseNote()).isNull();
        assertThat(accepted.version()).isEqualTo(1L);
        assertThat(accepted.applicationStatus())
            .isEqualTo(ApplicationStatus.HIRED);
        assertThat(accepted.applicationVersion()).isEqualTo(2L);
        assertThat(offer.getStatus()).isEqualTo(OfferStatus.ACCEPTED);
        assertThat(offer.getRespondedAt()).isEqualTo(NOW);
        assertThat(offer.getResponseNote()).isNull();
        assertThat(offer.getVersion()).isEqualTo(1L);
        assertThat(application.getStatus()).isEqualTo(ApplicationStatus.HIRED);
        assertThat(application.getVersion()).isEqualTo(2L);
        assertThat(acceptedHistory)
            .containsEntry("from_status", "OFFER")
            .containsEntry("to_status", "HIRED")
            .containsEntry("changed_by", CANDIDATE_ID)
            .containsEntry("note", null);
        assertThat(acceptedEvent.path("action").asText())
            .isEqualTo("STATUS_CHANGED");
        assertThat(acceptedEvent.path("actor_id").asText())
            .isEqualTo(CANDIDATE_ID.toString());
        assertThat(acceptedEvent.path("offer_status").asText())
            .isEqualTo("ACCEPTED");
        assertThat(acceptedEvent.path("offer_version").asLong())
            .isEqualTo(1L);
        assertThat(acceptedEvent.path("to_status").asText())
            .isEqualTo("HIRED");
        assertThat(history.count()).isEqualTo(2L);
        assertThat(outbox.count()).isEqualTo(2L);
    }

    @Test
    void declineCommitsOfferAndApplicationAsRejectedWithReason()
        throws Exception {
        UUID applicationId = saveApplication(
            ApplicationStatus.INTERVIEW,
            0L
        );
        OfferResponse sent = sendOffer(applicationId);

        OfferResponse declined = service.respond(
            sent.id(),
            CANDIDATE_ID,
            new RespondOfferRequest(
                OfferDecision.DECLINED,
                "  Compensation mismatch  ",
                0L,
                1L
            )
        );

        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow();
        OfferEntity offer = offers.findById(sent.id()).orElseThrow();
        Map<String, Object> declinedHistory = transitionHistory(
            applicationId,
            ApplicationStatus.REJECTED
        );
        JsonNode declinedEvent = responseEvent(applicationId);

        assertThat(declined.status()).isEqualTo(OfferStatus.DECLINED);
        assertThat(declined.responseNote())
            .isEqualTo("Compensation mismatch");
        assertThat(declined.version()).isEqualTo(1L);
        assertThat(declined.applicationStatus())
            .isEqualTo(ApplicationStatus.REJECTED);
        assertThat(declined.applicationVersion()).isEqualTo(2L);
        assertThat(offer.getStatus()).isEqualTo(OfferStatus.DECLINED);
        assertThat(offer.getRespondedAt()).isEqualTo(NOW);
        assertThat(offer.getResponseNote())
            .isEqualTo("Compensation mismatch");
        assertThat(offer.getVersion()).isEqualTo(1L);
        assertThat(application.getStatus())
            .isEqualTo(ApplicationStatus.REJECTED);
        assertThat(application.getVersion()).isEqualTo(2L);
        assertThat(declinedHistory)
            .containsEntry("from_status", "OFFER")
            .containsEntry("to_status", "REJECTED")
            .containsEntry("changed_by", CANDIDATE_ID)
            .containsEntry("note", "Compensation mismatch");
        assertThat(declinedEvent.path("offer_status").asText())
            .isEqualTo("DECLINED");
        assertThat(declinedEvent.path("to_status").asText())
            .isEqualTo("REJECTED");
        assertThat(history.count()).isEqualTo(2L);
        assertThat(outbox.count()).isEqualTo(2L);
    }

    @Test
    void expiredOfferIsRejectedWithoutChangingAnyPersistentState() {
        UUID applicationId = saveApplication(ApplicationStatus.OFFER, 1L);
        OfferEntity expired = offers.saveAndFlush(OfferEntity.sent(
            UUID.randomUUID(),
            applicationId,
            RECRUITER_ID,
            new BigDecimal("25000000.00"),
            LocalDate.of(2026, 9, 15),
            "Senior Backend Engineer",
            null,
            null,
            null,
            NOW.minusSeconds(7200),
            NOW.minusSeconds(1)
        ));

        assertThatThrownBy(() -> service.respond(
            expired.getId(),
            CANDIDATE_ID,
            new RespondOfferRequest(
                OfferDecision.ACCEPTED,
                null,
                0L,
                1L
            )
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(exception -> {
                BusinessException business = (BusinessException) exception;
                assertThat(business.code()).isEqualTo("OFFER_EXPIRED");
                assertThat(business.status()).isEqualTo(HttpStatus.CONFLICT);
            });

        assertOfferAndApplicationUnchanged(
            expired.getId(),
            applicationId,
            OfferStatus.SENT,
            ApplicationStatus.OFFER,
            0L,
            1L
        );
        assertThat(history.count()).isZero();
        assertThat(outbox.count()).isZero();
    }

    @Test
    void anotherCandidateCannotRespondAndNothingIsMutated() {
        UUID applicationId = saveApplication(
            ApplicationStatus.INTERVIEW,
            0L
        );
        OfferResponse sent = sendOffer(applicationId);

        assertThatThrownBy(() -> service.respond(
            sent.id(),
            OTHER_CANDIDATE_ID,
            new RespondOfferRequest(
                OfferDecision.ACCEPTED,
                null,
                0L,
                1L
            )
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(exception -> {
                BusinessException business = (BusinessException) exception;
                assertThat(business.code()).isEqualTo("OFFER_ACCESS_DENIED");
                assertThat(business.status()).isEqualTo(HttpStatus.FORBIDDEN);
            });

        assertOfferAndApplicationUnchanged(
            sent.id(),
            applicationId,
            OfferStatus.SENT,
            ApplicationStatus.OFFER,
            0L,
            1L
        );
        assertThat(history.count()).isEqualTo(1L);
        assertThat(outbox.count()).isEqualTo(1L);
    }

    @Test
    void outboxFailureRollsBackApplicationOfferAndHistory() {
        UUID applicationId = saveApplication(
            ApplicationStatus.INTERVIEW,
            0L
        );
        jdbc.execute(
            """
            ALTER TABLE application.application_event_outbox
            ADD CONSTRAINT application_offer_test_topic_check
            CHECK (topic <> 'application-events')
            """
        );

        try {
            assertThatThrownBy(() -> sendOffer(applicationId))
                .isInstanceOf(DataIntegrityViolationException.class);
        } finally {
            jdbc.execute(
                "ALTER TABLE application.application_event_outbox " +
                    "DROP CONSTRAINT IF EXISTS " + OUTBOX_TOPIC_CONSTRAINT
            );
        }

        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow();
        assertThat(application.getStatus())
            .isEqualTo(ApplicationStatus.INTERVIEW);
        assertThat(application.getVersion()).isZero();
        assertThat(offers.count()).isZero();
        assertThat(history.count()).isZero();
        assertThat(outbox.count()).isZero();
    }

    @Test
    void applicationUpdateFailureRollsBackOfferResponse() {
        UUID applicationId = saveApplication(
            ApplicationStatus.INTERVIEW,
            0L
        );
        OfferResponse sent = sendOffer(applicationId);
        jdbc.execute(
            "ALTER TABLE application.applications " +
                "ADD CONSTRAINT " + APPLICATION_STATUS_CONSTRAINT +
                " CHECK (status <> 'HIRED')"
        );

        try {
            assertThatThrownBy(() -> service.respond(
                sent.id(),
                CANDIDATE_ID,
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    0L,
                    1L
                )
            )).isInstanceOf(DataIntegrityViolationException.class);
        } finally {
            jdbc.execute(
                "ALTER TABLE application.applications " +
                    "DROP CONSTRAINT IF EXISTS " +
                    APPLICATION_STATUS_CONSTRAINT
            );
        }

        assertOfferAndApplicationUnchanged(
            sent.id(),
            applicationId,
            OfferStatus.SENT,
            ApplicationStatus.OFFER,
            0L,
            1L
        );
        assertThat(history.count()).isEqualTo(1L);
        assertThat(outbox.count()).isEqualTo(1L);
    }

    @Test
    void concurrentAcceptAndDeclineHaveOneWinnerAndConsistentState()
        throws Exception {
        UUID applicationId = saveApplication(
            ApplicationStatus.INTERVIEW,
            0L
        );
        OfferResponse sent = sendOffer(applicationId);
        CountDownLatch callersReady = new CountDownLatch(2);
        CountDownLatch startCalls = new CountDownLatch(1);
        executor = Executors.newFixedThreadPool(2);

        Future<Object> accept = executor.submit(() -> respondWhenReleased(
            callersReady,
            startCalls,
            sent.id(),
            OfferDecision.ACCEPTED,
            null
        ));
        Future<Object> decline = executor.submit(() -> respondWhenReleased(
            callersReady,
            startCalls,
            sent.id(),
            OfferDecision.DECLINED,
            "Accepted another offer"
        ));

        assertThat(callersReady.await(5, TimeUnit.SECONDS)).isTrue();
        startCalls.countDown();
        List<Object> outcomes = List.of(
            accept.get(10, TimeUnit.SECONDS),
            decline.get(10, TimeUnit.SECONDS)
        );
        List<OfferResponse> successes = outcomes.stream()
            .filter(OfferResponse.class::isInstance)
            .map(OfferResponse.class::cast)
            .toList();
        List<BusinessException> conflicts = outcomes.stream()
            .filter(BusinessException.class::isInstance)
            .map(BusinessException.class::cast)
            .toList();

        assertThat(successes).hasSize(1);
        assertThat(conflicts).singleElement().satisfies(conflict -> {
            assertThat(conflict.code()).isIn(
                "OFFER_ALREADY_RESPONDED",
                "OFFER_CHANGED_CONCURRENTLY"
            );
            assertThat(conflict.status()).isEqualTo(HttpStatus.CONFLICT);
        });

        OfferEntity offer = offers.findById(sent.id()).orElseThrow();
        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow();
        assertThat(offer.getVersion()).isEqualTo(1L);
        assertThat(application.getVersion()).isEqualTo(2L);
        if (offer.getStatus() == OfferStatus.ACCEPTED) {
            assertThat(application.getStatus())
                .isEqualTo(ApplicationStatus.HIRED);
            assertThat(offer.getResponseNote()).isNull();
        } else {
            assertThat(offer.getStatus()).isEqualTo(OfferStatus.DECLINED);
            assertThat(application.getStatus())
                .isEqualTo(ApplicationStatus.REJECTED);
            assertThat(offer.getResponseNote())
                .isEqualTo("Accepted another offer");
        }
        assertThat(history.count()).isEqualTo(2L);
        assertThat(outbox.count()).isEqualTo(2L);
    }

    private OfferResponse sendOffer(UUID applicationId) {
        return service.send(
            applicationId,
            RECRUITER_ID,
            AUTHORIZATION,
            new CreateOfferRequest(
                new BigDecimal("25000000"),
                LocalDate.of(2026, 9, 15),
                "  Senior Backend Engineer  ",
                "  Welcome aboard  ",
                FILE_ID,
                "  https://files.example.test/offers/offer.pdf  ",
                Instant.parse("2026-09-05T17:00:00Z"),
                0L
            )
        );
    }

    private UUID saveApplication(ApplicationStatus status, long version) {
        UUID applicationId = UUID.randomUUID();
        applications.saveAndFlush(ApplicationEntity.applied(
            applicationId,
            UUID.randomUUID(),
            COMPANY_ID,
            CANDIDATE_ID,
            JOB_OWNER_ID,
            UUID.randomUUID(),
            "Backend Engineer",
            "Offer integration candidate",
            ApplicationSource.SEARCH,
            NOW.minusSeconds(86400)
        ));
        jdbc.update(
            "UPDATE application.applications SET status = ?, version = ? " +
                "WHERE id = ?",
            status.name(),
            version,
            applicationId
        );
        return applicationId;
    }

    private Map<String, Object> transitionHistory(
        UUID applicationId,
        ApplicationStatus target
    ) {
        return jdbc.queryForMap(
            """
            SELECT from_status, to_status, changed_by, note, changed_at
            FROM application.application_history
            WHERE application_id = ? AND to_status = ?
            """,
            applicationId,
            target.name()
        );
    }

    private JsonNode responseEvent(UUID applicationId) {
        String payload = jdbc.queryForObject(
            """
            SELECT payload
            FROM application.application_event_outbox
            WHERE aggregate_id = ?
              AND payload::jsonb ->> 'action' = 'STATUS_CHANGED'
              AND payload::jsonb ->> 'from_status' = 'OFFER'
            """,
            String.class,
            applicationId
        );
        return readEvent(payload);
    }

    private JsonNode readEvent(String payload) {
        try {
            return objectMapper.readTree(payload);
        } catch (Exception exception) {
            throw new IllegalStateException(
                "Cannot parse outbox payload",
                exception
            );
        }
    }

    private void assertOfferAndApplicationUnchanged(
        UUID offerId,
        UUID applicationId,
        OfferStatus offerStatus,
        ApplicationStatus applicationStatus,
        long offerVersion,
        long applicationVersion
    ) {
        OfferEntity offer = offers.findById(offerId).orElseThrow();
        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow();
        assertThat(offer.getStatus()).isEqualTo(offerStatus);
        assertThat(offer.getVersion()).isEqualTo(offerVersion);
        assertThat(offer.getRespondedAt()).isNull();
        assertThat(offer.getResponseNote()).isNull();
        assertThat(application.getStatus()).isEqualTo(applicationStatus);
        assertThat(application.getVersion()).isEqualTo(applicationVersion);
    }

    private Object respondWhenReleased(
        CountDownLatch callersReady,
        CountDownLatch startCalls,
        UUID offerId,
        OfferDecision decision,
        String declineReason
    ) {
        callersReady.countDown();
        await(startCalls);
        try {
            return service.respond(
                offerId,
                CANDIDATE_ID,
                new RespondOfferRequest(
                    decision,
                    declineReason,
                    0L,
                    1L
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
                    "Timed out while coordinating concurrent offer responses"
                );
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                "Interrupted while coordinating concurrent offer responses",
                exception
            );
        }
    }

    @TestConfiguration
    static class TestOfferConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper().findAndRegisterModules();
        }

        @Bean
        ApplicationOfferService applicationOfferService(
            ApplicationPipelineRepository applications,
            OfferRepository offers,
            ApplicationHistoryWriter history,
            ApplicationEventOutboxRepository outbox,
            CompanyClient companies,
            ObjectMapper objectMapper
        ) {
            return new ApplicationOfferService(
                applications,
                offers,
                history,
                outbox,
                companies,
                objectMapper,
                CLOCK,
                TOPIC
            );
        }
    }
}
