package com.recruitment.application.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Opt-in regression gate against a disposable local PostgreSQL 16 database.
 * The strict URL guard prevents this destructive test fixture from targeting a
 * project database. No Docker daemon or Kafka broker is needed: Kafka delivery
 * is controlled while the real migration, repository SQL and row locks execute.
 *
 * APPLICATION_OUTBOX_TEST_URL=jdbc:postgresql://127.0.0.1:55487/person2_outbox_test
 * mvn -Dtest=ApplicationOutboxOrderingPostgresIT test
 */
@EnabledIfEnvironmentVariable(named = "APPLICATION_OUTBOX_TEST_URL", matches = ".+")
@DataJpaTest(properties = {
    "application-events.publish-delay-ms=3600000",
    "application-events.publish-initial-delay-ms=3600000",
    "spring.jpa.hibernate.ddl-auto=validate",
    "spring.jpa.properties.hibernate.default_schema=application",
    "spring.flyway.enabled=true",
    "spring.flyway.create-schemas=true",
    "spring.flyway.default-schema=application",
    "spring.flyway.schemas=application",
    "spring.jpa.show-sql=false"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import(ApplicationOutboxPublisher.class)
class ApplicationOutboxOrderingPostgresIT {
    private static final String TOPIC = "application-events-ordering-test";
    private static final Instant NOW = Instant.parse("2026-09-01T00:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String url = System.getenv("APPLICATION_OUTBOX_TEST_URL");
        if (url == null || !url.matches(
            "jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/person2_outbox_test"
        )) {
            throw new IllegalArgumentException("A disposable person2_outbox_test database is required");
        }
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> "person2_test");
        registry.add("spring.datasource.password", () -> "");
    }

    @Autowired private ApplicationEventOutboxRepository outbox;
    @Autowired private ApplicationOutboxPublisher publisher;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactions;
    @MockBean private KafkaTemplate<String, String> kafka;

    @BeforeEach
    void cleanFixture() {
        jdbc.execute("TRUNCATE application.application_event_outbox");
        when(kafka.send(anyString(), anyString(), anyString()))
            .thenReturn(CompletableFuture.completedFuture(null));
    }

    @Test
    void versionOrderWinsOverClockSkewAndTimestampTies() {
        UUID aggregate = UUID.randomUUID();
        insert(aggregate, "{\"aggregate_version\":2}", NOW.minusSeconds(30), NOW);
        UUID first = insert(aggregate, "{\"aggregate_version\":0}", NOW, NOW);
        insert(aggregate, "{\"aggregate_version\":1}", NOW, NOW);
        assertThat(claim()).extracting(ApplicationEventOutboxEntity::getId).containsExactly(first);
        assertThat(jdbc.queryForObject(
            "SELECT aggregate_version FROM application.application_event_outbox WHERE id = ?",
            Long.class, first
        )).isZero();
    }

    @Test
    void predecessorBackoffBlocksOnlyItsOwnAggregate() {
        UUID aggregate = UUID.randomUUID();
        insert(aggregate, "{\"aggregate_version\":0}", NOW, NOW.plusSeconds(60));
        insert(aggregate, "{\"aggregate_version\":1}", NOW.plusMillis(1), NOW);
        UUID other = insert(UUID.randomUUID(), "{\"aggregate_version\":0}", NOW, NOW);
        assertThat(claim()).extracting(ApplicationEventOutboxEntity::getId).containsExactly(other);
    }

    @Test
    void legacyPendingEventDrainsBeforeCanonicalSuccessor() {
        UUID aggregate = UUID.randomUUID();
        insert(aggregate, "{\"aggregate_version\":9}", NOW.minusSeconds(1), NOW);
        UUID legacy = insert(aggregate, "{}", NOW, NOW);
        assertThat(claim()).extracting(ApplicationEventOutboxEntity::getId).containsExactly(legacy);
    }

    @Test
    void replicasSkipLockedHeadWithoutOvertakingIt() throws Exception {
        UUID aggregate = UUID.randomUUID();
        UUID head = insert(aggregate, "{\"aggregate_version\":0}", NOW, NOW);
        UUID successor = insert(aggregate, "{\"aggregate_version\":1}", NOW, NOW);
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (var executor = Executors.newSingleThreadExecutor()) {
            var firstReplica = executor.submit(() -> new TransactionTemplate(transactions).execute(status -> {
                List<ApplicationEventOutboxEntity> rows = outbox.lockNextPublishableBatch(NOW);
                assertThat(rows).extracting(ApplicationEventOutboxEntity::getId).containsExactly(head);
                locked.countDown();
                try {
                    if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("lock test timed out");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(error);
                }
                rows.getFirst().markPublished(NOW);
                return rows.size();
            }));
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                UUID unrelated = insert(UUID.randomUUID(), "{\"aggregate_version\":0}", NOW, NOW);
                assertThat(claim()).extracting(ApplicationEventOutboxEntity::getId).containsExactly(unrelated);
                jdbc.update("UPDATE application.application_event_outbox SET published_at = ? WHERE id = ?",
                    Timestamp.from(NOW), unrelated);
            } finally {
                release.countDown();
            }
            assertThat(firstReplica.get(5, TimeUnit.SECONDS)).isEqualTo(1);
        }
        assertThat(claim()).extracting(ApplicationEventOutboxEntity::getId).containsExactly(successor);
    }

    @Test
    void publisherFailureBacksOffAndRetriesBeforeSuccessor() {
        UUID aggregate = UUID.randomUUID();
        String initial = "{\"aggregate_version\":0}";
        String next = "{\"aggregate_version\":1}";
        UUID head = insert(aggregate, initial, NOW, NOW);
        insert(aggregate, next, NOW, NOW);
        when(kafka.send(TOPIC, aggregate.toString(), initial))
            .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("controlled broker failure")))
            .thenReturn(CompletableFuture.completedFuture(null));

        publisher.publishPending();
        assertThat(jdbc.queryForObject(
            "SELECT attempts FROM application.application_event_outbox WHERE id = ?", Integer.class, head
        )).isEqualTo(1);
        assertThat(jdbc.queryForObject(
            "SELECT next_attempt_at > now() FROM application.application_event_outbox WHERE id = ?", Boolean.class, head
        )).isTrue();
        publisher.publishPending();
        verify(kafka, never()).send(TOPIC, aggregate.toString(), next);

        jdbc.update("UPDATE application.application_event_outbox SET next_attempt_at = ? WHERE id = ?",
            Timestamp.from(NOW), head);
        publisher.publishPending();
        publisher.publishPending();
        var order = inOrder(kafka);
        order.verify(kafka, times(2)).send(TOPIC, aggregate.toString(), initial);
        order.verify(kafka).send(TOPIC, aggregate.toString(), next);
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM application.application_event_outbox WHERE published_at IS NULL", Integer.class
        )).isZero();
    }

    @Test
    void rolledBackAcknowledgementRemainsReplayableWithSameEventId() {
        UUID head = insert(UUID.randomUUID(), "{\"aggregate_version\":0}", NOW, NOW);
        assertThatThrownBy(() -> new TransactionTemplate(transactions).execute(status -> {
            outbox.lockNextPublishableBatch(NOW).getFirst().markPublished(NOW);
            throw new IllegalStateException("transaction rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(claim()).extracting(ApplicationEventOutboxEntity::getId).containsExactly(head);
    }

    private List<ApplicationEventOutboxEntity> claim() {
        return new TransactionTemplate(transactions).execute(status -> outbox.lockNextPublishableBatch(NOW));
    }

    private UUID insert(UUID aggregate, String payload, Instant createdAt, Instant nextAttemptAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO application.application_event_outbox
                (id, aggregate_id, event_key, topic, payload, attempts, next_attempt_at, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            """, id, aggregate, aggregate, TOPIC, payload, Timestamp.from(nextAttemptAt), Timestamp.from(createdAt));
        return id;
    }
}
