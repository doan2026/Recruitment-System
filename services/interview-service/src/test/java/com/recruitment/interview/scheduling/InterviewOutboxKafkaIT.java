package com.recruitment.interview.scheduling;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.interview.client.ApplicationAuthorizationContext;
import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.event.InterviewOutboxPublisher;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
@SpringBootTest
class InterviewOutboxKafkaIT {
    private static final String TOPIC = "interview-events-it";
    private static final String INTERNAL_KEY =
        "interview-kafka-integration-key-000000000000000001";
    private static final Path PUBLIC_KEY = createPublicKey();

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("interview_event_test")
            .withUsername("interview")
            .withPassword("interview");

    @Container
    static final KafkaContainer KAFKA =
        new KafkaContainer("apache/kafka-native:3.8.0");

    @Autowired
    private InterviewSchedulingService scheduling;
    @Autowired
    private InterviewOutboxPublisher publisher;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ApplicationClient applications;
    @MockBean
    private JwtDecoder jwtDecoder;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add(
            "spring.kafka.bootstrap-servers",
            KAFKA::getBootstrapServers
        );
        registry.add("JWT_PUBLIC_KEY_PATH", () -> PUBLIC_KEY.toString());
        registry.add("APPLICATION_INTERNAL_API_KEY", () -> INTERNAL_KEY);
        registry.add(
            "interview.application-client.internal-api-key",
            () -> INTERNAL_KEY
        );
        registry.add("interview-events.topic", () -> TOPIC);
        registry.add(
            "interview-events.publish-initial-delay-ms",
            () -> "300000"
        );
        registry.add(
            "interview-events.poll-delay-ms",
            () -> "300000"
        );
    }

    @BeforeEach
    void setUp() throws Exception {
        jdbc.execute(
            """
            TRUNCATE TABLE
                interview.interview_event_outbox,
                interview.interviews
            CASCADE
            """
        );
        createTopic();
    }

    @AfterAll
    static void removePublicKey() throws Exception {
        Files.deleteIfExists(PUBLIC_KEY);
    }

    @Test
    void scheduledInterviewPublishesCanonicalEventOnce() throws Exception {
        UUID interviewerId = UUID.randomUUID();
        UUID candidateId = UUID.randomUUID();
        UUID applicationId = UUID.randomUUID();
        UUID companyId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        when(applications.authorizeScheduling(
            org.mockito.ArgumentMatchers.eq(applicationId),
            anyString()
        )).thenReturn(new ApplicationAuthorizationContext(
            applicationId,
            companyId,
            jobId,
            candidateId,
            "REVIEWING",
            4L
        ));
        OffsetDateTime start = OffsetDateTime.now(ZoneOffset.UTC)
            .plusDays(30)
            .withHour(9)
            .withMinute(0)
            .withSecond(0)
            .withNano(0);

        try (KafkaConsumer<String, String> consumer = consumer()) {
            consumer.subscribe(List.of(TOPIC));
            awaitAssignment(consumer);
            ScheduleInterviewResult scheduled = scheduling.schedule(
                interviewerId,
                "token",
                new CreateInterviewRequest(
                    applicationId,
                    UUID.randomUUID(),
                    2,
                    start,
                    "UTC",
                    45,
                    InterviewMode.OFFLINE,
                    "Private room excluded from event",
                    "Secret note excluded from event"
                )
            );

            assertThat(pendingCount()).isOne();
            assertThat(publisher.publishPending()).isOne();

            ConsumerRecord<String, String> received = receiveOne(consumer);
            JsonNode payload = objectMapper.readTree(received.value());
            Map<String, Object> persisted = jdbc.queryForMap(
                """
                SELECT event_id, event_key, topic, payload::text AS payload,
                       attempts, published_at, last_error_code
                FROM interview.interview_event_outbox
                WHERE interview_id = ?
                """,
                scheduled.interview().id()
            );

            assertThat(received.key())
                .isEqualTo(scheduled.interview().id().toString());
            assertThat(received.value()).isEqualTo(persisted.get("payload"));
            assertThat(payload.fieldNames()).toIterable()
                .containsExactlyInAnyOrderElementsOf(Set.of(
                    "schema_version",
                    "event_id",
                    "action",
                    "interview_id",
                    "application_id",
                    "candidate_id",
                    "interviewer_id",
                    "actor_id",
                    "round_number",
                    "schedule_revision",
                    "scheduled_start_at",
                    "scheduled_end_at",
                    "status",
                    "aggregate_version",
                    "occurred_at"
                ));
            assertThat(payload.path("schema_version").asInt()).isEqualTo(1);
            assertThat(payload.path("action").asText())
                .isEqualTo("SCHEDULED");
            assertThat(payload.path("interview_id").asText())
                .isEqualTo(scheduled.interview().id().toString());
            assertThat(payload.path("candidate_id").asText())
                .isEqualTo(candidateId.toString());
            assertThat(payload.path("interviewer_id").asText())
                .isEqualTo(interviewerId.toString());
            assertThat(payload.path("actor_id").asText())
                .isEqualTo(interviewerId.toString());
            assertThat(payload.path("aggregate_version").asLong())
                .isZero();
            assertThat(payload.has("location")).isFalse();
            assertThat(payload.has("notes")).isFalse();
            assertThat(payload.has("room_url")).isFalse();
            assertThat(persisted)
                .containsEntry("event_key", scheduled.interview().id())
                .containsEntry("topic", TOPIC)
                .containsEntry("attempts", 1)
                .containsEntry("last_error_code", null);
            assertThat(persisted.get("published_at")).isNotNull();
            assertThat(payload.path("event_id").asText())
                .isEqualTo(persisted.get("event_id").toString());

            assertThat(publisher.publishPending()).isZero();
            assertThat(consumer.poll(Duration.ofSeconds(2))).isEmpty();
        }
    }

    private Long pendingCount() {
        return jdbc.queryForObject(
            """
            SELECT COUNT(*)
            FROM interview.interview_event_outbox
            WHERE published_at IS NULL
            """,
            Long.class
        );
    }

    private static void createTopic() throws Exception {
        Map<String, Object> properties = Map.of(
            AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG,
            KAFKA.getBootstrapServers()
        );
        try (AdminClient admin = AdminClient.create(properties)) {
            if (!admin.listTopics().names().get(15, TimeUnit.SECONDS)
                .contains(TOPIC)) {
                admin.createTopics(List.of(new NewTopic(TOPIC, 1, (short) 1)))
                    .all()
                    .get(15, TimeUnit.SECONDS);
            }
        }
    }

    private KafkaConsumer<String, String> consumer() {
        Map<String, Object> properties = new HashMap<>();
        properties.put(
            ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG,
            KAFKA.getBootstrapServers()
        );
        properties.put(
            ConsumerConfig.GROUP_ID_CONFIG,
            "interview-outbox-it-" + UUID.randomUUID()
        );
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.ALLOW_AUTO_CREATE_TOPICS_CONFIG, false);
        properties.put(
            ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG,
            StringDeserializer.class
        );
        properties.put(
            ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,
            StringDeserializer.class
        );
        return new KafkaConsumer<>(properties);
    }

    private void awaitAssignment(KafkaConsumer<String, String> consumer) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (
            consumer.assignment().isEmpty() &&
            System.nanoTime() < deadline
        ) {
            consumer.poll(Duration.ofMillis(100));
        }
        assertThat(consumer.assignment()).isNotEmpty();
    }

    private ConsumerRecord<String, String> receiveOne(
        KafkaConsumer<String, String> consumer
    ) {
        ConsumerRecords<String, String> records = consumer.poll(
            Duration.ofSeconds(10)
        );
        assertThat(records.count()).isOne();
        return records.iterator().next();
    }

    private static Path createPublicKey() {
        try {
            KeyPairGenerator generator =
                KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            byte[] encoded = generator.generateKeyPair()
                .getPublic()
                .getEncoded();
            String body = Base64.getMimeEncoder(64, new byte[] {'\n'})
                .encodeToString(encoded);
            Path file = Files.createTempFile(
                "interview-event-public-",
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
