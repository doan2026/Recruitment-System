package com.recruitment.interview.event;

import static org.assertj.core.api.Assertions.assertThat;

import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.repository.InterviewRepository;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@SpringBootTest
class InterviewOutboxStorePostgresIT {
    private static final String INTERNAL_KEY =
        "interview-outbox-store-integration-key-000000000001";
    private static final Path PUBLIC_KEY = createPublicKey();

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("interview_outbox_store_test")
            .withUsername("interview")
            .withPassword("interview");

    @Autowired
    private InterviewRepository interviews;
    @Autowired
    private InterviewEventOutboxWriter writer;
    @Autowired
    private InterviewOutboxStore outbox;
    @Autowired
    private TransactionTemplate transactions;
    @Autowired
    private JdbcTemplate jdbc;

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
        registry.add("APPLICATION_INTERNAL_API_KEY", () -> INTERNAL_KEY);
        registry.add(
            "interview.application-client.internal-api-key",
            () -> INTERNAL_KEY
        );
        registry.add("interview-events.publisher-enabled", () -> "false");
    }

    @BeforeEach
    void clearDatabase() {
        jdbc.execute("""
            TRUNCATE TABLE
                interview.interview_event_outbox,
                interview.interviews
            CASCADE
            """);
    }

    @AfterAll
    static void removePublicKey() throws Exception {
        Files.deleteIfExists(PUBLIC_KEY);
    }

    @Test
    void expiredLeaseUsesFenceAndBlocksLaterAggregateUntilPublished() {
        Instant createdAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        InterviewEntity interview = interviews.saveAndFlush(
            InterviewEntity.schedule(
                UUID.randomUUID(),
                UUID.randomUUID(),
                1,
                "REVIEWING",
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                "a".repeat(64),
                1,
                createdAt.plus(30, ChronoUnit.DAYS),
                createdAt.plus(30, ChronoUnit.DAYS).plus(45, ChronoUnit.MINUTES),
                "UTC",
                45,
                InterviewMode.OFFLINE,
                "Room A",
                null,
                createdAt
            )
        );
        transactions.executeWithoutResult(status ->
            writer.appendScheduled(interview)
        );
        UUID laterEventId = UUID.randomUUID();
        insertLaterVersion(interview.getId(), laterEventId);
        List<UUID> eventIds = jdbc.queryForList(
            """
            SELECT event_id
            FROM interview.interview_event_outbox
            WHERE interview_id = ?
            ORDER BY aggregate_version
            """,
            UUID.class,
            interview.getId()
        );

        Instant firstClaimAt = createdAt.plusSeconds(1);
        InterviewOutboxRecord firstLease = outbox.claimNext(
            "worker-a",
            firstClaimAt,
            firstClaimAt.plusSeconds(1)
        ).orElseThrow();
        assertThat(firstLease.eventId()).isEqualTo(eventIds.getFirst());
        assertThat(outbox.claimNext(
            "worker-b",
            firstClaimAt,
            firstClaimAt.plusSeconds(1)
        )).isEmpty();

        Instant reclaimedAt = firstClaimAt.plusSeconds(2);
        InterviewOutboxRecord secondLease = outbox.claimNext(
            "worker-b",
            reclaimedAt,
            reclaimedAt.plusSeconds(10)
        ).orElseThrow();
        assertThat(secondLease.eventId()).isEqualTo(firstLease.eventId());
        assertThat(secondLease.leaseFence()).isGreaterThan(firstLease.leaseFence());
        assertThat(outbox.markPublished(
            firstLease,
            "worker-a",
            reclaimedAt
        )).isFalse();
        assertThat(outbox.markPublished(
            secondLease,
            "worker-b",
            reclaimedAt
        )).isTrue();

        Optional<InterviewOutboxRecord> later = outbox.claimNext(
            "worker-b",
            reclaimedAt,
            reclaimedAt.plusSeconds(10)
        );
        assertThat(later).isPresent();
        assertThat(later.orElseThrow().eventId()).isEqualTo(laterEventId);
    }

    private void insertLaterVersion(UUID interviewId, UUID eventId) {
        jdbc.update("""
            INSERT INTO interview.interview_event_outbox (
                event_id, interview_id, aggregate_version, action,
                topic, event_key, payload, next_attempt_at, created_at
            )
            SELECT ?, interview_id, 1, action, topic, event_key,
                   jsonb_set(
                       jsonb_set(
                           payload,
                           '{event_id}',
                           to_jsonb(CAST(? AS text))
                       ),
                       '{aggregate_version}',
                       '1'::jsonb
                   ),
                   created_at, created_at
            FROM interview.interview_event_outbox
            WHERE interview_id = ? AND aggregate_version = 0
            """,
            eventId,
            eventId,
            interviewId
        );
    }

    private static Path createPublicKey() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            byte[] encoded = generator.generateKeyPair()
                .getPublic()
                .getEncoded();
            String body = Base64.getMimeEncoder(64, new byte[] {'\n'})
                .encodeToString(encoded);
            Path file = Files.createTempFile(
                "interview-outbox-store-public-",
                ".pem"
            );
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
}
