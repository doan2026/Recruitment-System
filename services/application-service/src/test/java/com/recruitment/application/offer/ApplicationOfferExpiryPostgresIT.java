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
import com.recruitment.application.pipeline.ApplicationPipelineService;
import com.recruitment.application.pipeline.ChangeApplicationStatusRequest;
import com.recruitment.application.pipeline.WithdrawApplicationRequest;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.ApplicationHistoryRepository;
import com.recruitment.application.repository.OfferRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
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
    ApplicationPipelineService.class,
    ApplicationOfferExpiryService.class,
    ApplicationOfferExpiryPostgresIT.TestExpiryConfiguration.class
})
class ApplicationOfferExpiryPostgresIT {
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
    private static final Instant NOW = Instant.parse("2026-08-29T10:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final String TOPIC = "application-events";
    private static final String AUTHORIZATION = "Bearer expiry-integration";

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
    private ApplicationOfferExpiryService expiry;

    @Autowired
    private ApplicationOfferService offerService;

    @Autowired
    private ApplicationPipelineService pipeline;

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
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
    }

    @AfterEach
    void tearDown() throws InterruptedException {
        if (executor == null) return;
        executor.shutdownNow();
        assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    void expiresOnlyLapsedSentOffersAndLeavesEveryOtherOfferAlone() {
        UUID lapsedOffer = saveOffer(
            OfferStatus.SENT,
            NOW.minusSeconds(3600)
        );
        UUID boundaryOffer = saveOffer(OfferStatus.SENT, NOW);
        UUID openOffer = saveOffer(OfferStatus.SENT, NOW.plusSeconds(1));
        UUID acceptedOffer = saveOffer(
            OfferStatus.ACCEPTED,
            NOW.minusSeconds(3600)
        );
        UUID declinedOffer = saveOffer(
            OfferStatus.DECLINED,
            NOW.minusSeconds(3600)
        );
        UUID cancelledOffer = saveOffer(
            OfferStatus.CANCELLED,
            NOW.minusSeconds(3600)
        );

        assertThat(expiry.expireBatch(NOW, 100)).isEqualTo(2);

        assertExpired(lapsedOffer, NOW.minusSeconds(3600));
        assertExpired(boundaryOffer, NOW);
        assertThat(offerState(openOffer))
            .containsEntry("status", "SENT")
            .containsEntry("responded_at", null)
            .containsEntry("version", 0L);
        assertThat(offerState(acceptedOffer))
            .containsEntry("status", "ACCEPTED")
            .containsEntry("version", 1L);
        assertThat(offerState(declinedOffer))
            .containsEntry("status", "DECLINED")
            .containsEntry("version", 1L);
        assertThat(offerState(cancelledOffer))
            .containsEntry("status", "CANCELLED")
            .containsEntry("version", 1L);
    }

    @Test
    void expiryTouchesNeitherTheApplicationNorHistoryNorTheOutbox() {
        UUID applicationId = saveApplication(ApplicationStatus.OFFER, 1L);
        saveOffer(applicationId, OfferStatus.SENT, NOW.minusSeconds(60));

        assertThat(expiry.expireBatch(NOW, 100)).isEqualTo(1);

        Map<String, Object> application = jdbc.queryForMap(
            "SELECT status, version FROM application.applications WHERE id = ?",
            applicationId
        );
        assertThat(application)
            .containsEntry("status", "OFFER")
            .containsEntry("version", 1L);
        assertThat(history.count()).isZero();
        assertThat(outbox.count()).isZero();
    }

    @Test
    void aSecondScanOverTheSameStateChangesNothing() {
        UUID offerId = saveOffer(OfferStatus.SENT, NOW.minusSeconds(60));

        assertThat(expiry.expireBatch(NOW, 100)).isEqualTo(1);
        Map<String, Object> afterFirst = offerState(offerId);

        assertThat(expiry.expireBatch(NOW, 100)).isZero();
        assertThat(expiry.expireBatch(NOW.plusSeconds(86400), 100)).isZero();
        assertThat(offerState(offerId)).isEqualTo(afterFirst);
    }

    @Test
    void aBacklogLargerThanOneBatchDrainsAcrossBatches() {
        for (int index = 0; index < 5; index++) {
            saveOffer(OfferStatus.SENT, NOW.minusSeconds(600 + index));
        }

        ApplicationOfferExpiryWorker worker = new ApplicationOfferExpiryWorker(
            expiry,
            CLOCK,
            2,
            10
        );
        worker.expireOverdueOffers();

        assertThat(countByStatus("EXPIRED")).isEqualTo(5L);
        assertThat(countByStatus("SENT")).isZero();
    }

    @Test
    void oneScanStopsAtItsBatchBudgetAndTheNextScanFinishes() {
        for (int index = 0; index < 5; index++) {
            saveOffer(OfferStatus.SENT, NOW.minusSeconds(600 + index));
        }

        ApplicationOfferExpiryWorker worker = new ApplicationOfferExpiryWorker(
            expiry,
            CLOCK,
            2,
            2
        );
        worker.expireOverdueOffers();

        assertThat(countByStatus("EXPIRED")).isEqualTo(4L);
        assertThat(countByStatus("SENT")).isEqualTo(1L);

        worker.expireOverdueOffers();

        assertThat(countByStatus("EXPIRED")).isEqualTo(5L);
        assertThat(countByStatus("SENT")).isZero();
    }

    @Test
    void concurrentScansExpireEveryLapsedOfferExactlyOnce()
        throws Exception {
        int offerCount = 40;
        for (int index = 0; index < offerCount; index++) {
            saveOffer(OfferStatus.SENT, NOW.minusSeconds(600 + index));
        }
        int scanners = 4;
        executor = Executors.newFixedThreadPool(scanners);
        CountDownLatch ready = new CountDownLatch(scanners);
        CountDownLatch start = new CountDownLatch(1);

        List<Future<Integer>> scans = new ArrayList<>();
        for (int index = 0; index < scanners; index++) {
            scans.add(executor.submit(() -> {
                ready.countDown();
                await(start);
                int expired = 0;
                for (int batch = 0; batch < 40; batch++) {
                    int changed = expiry.expireBatch(NOW, 5);
                    expired += changed;
                    if (changed == 0) break;
                }
                return expired;
            }));
        }
        await(ready);
        start.countDown();

        int reported = 0;
        for (Future<Integer> scan : scans) {
            reported += scan.get(60, TimeUnit.SECONDS);
        }

        // SKIP LOCKED hands every scanner a disjoint claim: the reported
        // counts account for the expired rows exactly once, and no row was
        // updated twice. A scanner may still stop early because a rival holds
        // the rows it would have claimed, so a final sequential drain proves
        // the backlog is reachable rather than lost.
        assertThat(reported).isEqualTo(countByStatus("EXPIRED"));
        assertThat(jdbc.queryForObject(
            """
            SELECT COUNT(*) FROM application.offers
            WHERE status = 'EXPIRED' AND version <> 1
            """,
            Long.class
        )).isZero();

        while (expiry.expireBatch(NOW, 100) > 0) {
            // drain whatever a scanner skipped
        }

        assertThat(countByStatus("EXPIRED")).isEqualTo((long) offerCount);
        assertThat(countByStatus("SENT")).isZero();
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.offers WHERE version <> 1",
            Long.class
        )).isZero();
    }

    @Test
    void candidateStillGetsOfferExpiredAfterTheWorkerResolvedTheRow() {
        UUID applicationId = saveApplication(ApplicationStatus.OFFER, 1L);
        UUID offerId = saveOffer(
            applicationId,
            OfferStatus.SENT,
            NOW.minusSeconds(60)
        );
        assertThat(expiry.expireBatch(NOW, 100)).isEqualTo(1);
        Map<String, Object> beforeResponse = offerState(offerId);

        assertThatThrownBy(() -> offerService.respond(
            offerId,
            CANDIDATE_ID,
            new RespondOfferRequest(OfferDecision.ACCEPTED, null, 1L, 1L)
        ))
            .isInstanceOfSatisfying(BusinessException.class, business -> {
                assertThat(business.code()).isEqualTo("OFFER_EXPIRED");
                assertThat(business.status()).isEqualTo(HttpStatus.CONFLICT);
            });

        assertThat(offerState(offerId)).isEqualTo(beforeResponse);
        assertThat(history.count()).isZero();
        assertThat(outbox.count()).isZero();
    }

    @Test
    void recruiterCanStillRejectAnApplicationWhoseOfferAlreadyExpired() {
        UUID applicationId = saveApplication(ApplicationStatus.OFFER, 1L);
        UUID offerId = saveOffer(
            applicationId,
            OfferStatus.SENT,
            NOW.minusSeconds(60)
        );
        assertThat(expiry.expireBatch(NOW, 100)).isEqualTo(1);
        Map<String, Object> afterExpiry = offerState(offerId);

        pipeline.changeStatus(
            applicationId,
            RECRUITER_ID,
            AUTHORIZATION,
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REJECTED,
                "Offer lapsed without a response",
                1L
            )
        );

        assertThat(jdbc.queryForObject(
            "SELECT status FROM application.applications WHERE id = ?",
            String.class,
            applicationId
        )).isEqualTo("REJECTED");
        // The expired Offer is already terminal, so the transition leaves it
        // exactly as the worker wrote it.
        assertThat(offerState(offerId)).isEqualTo(afterExpiry);
        JsonNode event = onlyEvent();
        assertThat(event.path("action").asText()).isEqualTo("STATUS_CHANGED");
        assertThat(event.path("from_status").asText()).isEqualTo("OFFER");
        assertThat(event.path("to_status").asText()).isEqualTo("REJECTED");
        assertThat(event.has("offer_id")).isFalse();
        assertThat(event.has("offer_status")).isFalse();
        assertThat(event.has("offer_version")).isFalse();
    }

    @Test
    void candidateCanStillWithdrawAnApplicationWhoseOfferAlreadyExpired() {
        UUID applicationId = saveApplication(ApplicationStatus.OFFER, 1L);
        UUID offerId = saveOffer(
            applicationId,
            OfferStatus.SENT,
            NOW.minusSeconds(60)
        );
        assertThat(expiry.expireBatch(NOW, 100)).isEqualTo(1);
        Map<String, Object> afterExpiry = offerState(offerId);

        pipeline.withdraw(
            applicationId,
            CANDIDATE_ID,
            new WithdrawApplicationRequest("Accepted elsewhere", 1L)
        );

        assertThat(jdbc.queryForObject(
            "SELECT status FROM application.applications WHERE id = ?",
            String.class,
            applicationId
        )).isEqualTo("WITHDRAWN");
        assertThat(offerState(offerId)).isEqualTo(afterExpiry);
        assertThat(onlyEvent().has("offer_status")).isFalse();
    }

    private UUID saveOffer(OfferStatus status, Instant expiresAt) {
        return saveOffer(
            saveApplication(ApplicationStatus.OFFER, 1L),
            status,
            expiresAt
        );
    }

    private UUID saveOffer(
        UUID applicationId,
        OfferStatus status,
        Instant expiresAt
    ) {
        UUID offerId = UUID.randomUUID();
        offers.saveAndFlush(OfferEntity.sent(
            offerId,
            applicationId,
            RECRUITER_ID,
            new BigDecimal("25000000.00"),
            LocalDate.of(2026, 12, 15),
            "Backend Engineer",
            null,
            null,
            null,
            expiresAt.minusSeconds(7 * 86_400),
            expiresAt
        ));
        if (status != OfferStatus.SENT) {
            jdbc.update(
                """
                UPDATE application.offers
                SET status = ?,
                    responded_at = ?,
                    response_note = ?,
                    version = 1
                WHERE id = ?
                """,
                status.name(),
                java.sql.Timestamp.from(expiresAt.minusSeconds(60)),
                status == OfferStatus.DECLINED ? "Accepted elsewhere" : null,
                offerId
            );
        }
        return offerId;
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
            "Offer expiry integration candidate",
            ApplicationSource.SEARCH,
            NOW.minusSeconds(30 * 86_400)
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

    private void assertExpired(UUID offerId, Instant expiresAt) {
        Map<String, Object> state = offerState(offerId);
        assertThat(state)
            .containsEntry("status", "EXPIRED")
            .containsEntry("response_note", null)
            .containsEntry("version", 1L);
        assertThat(
            ((java.sql.Timestamp) state.get("responded_at")).toInstant()
        ).isEqualTo(expiresAt);
    }

    private Map<String, Object> offerState(UUID offerId) {
        return jdbc.queryForMap(
            """
            SELECT status, responded_at, response_note, version
            FROM application.offers
            WHERE id = ?
            """,
            offerId
        );
    }

    private long countByStatus(String status) {
        return jdbc.queryForObject(
            "SELECT COUNT(*) FROM application.offers WHERE status = ?",
            Long.class,
            status
        );
    }

    private JsonNode onlyEvent() {
        List<String> payloads = jdbc.queryForList(
            "SELECT payload FROM application.application_event_outbox",
            String.class
        );
        assertThat(payloads).hasSize(1);
        try {
            return objectMapper.readTree(payloads.get(0));
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException(
                    "Timed out while coordinating concurrent expiry scans"
                );
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    @TestConfiguration
    static class TestExpiryConfiguration {
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
