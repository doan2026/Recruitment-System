package com.recruitment.application.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.pipeline.ApplicationHistoryWriter;
import com.recruitment.application.pipeline.ApplicationPipelineService;
import com.recruitment.application.pipeline.ChangeApplicationStatusRequest;
import com.recruitment.application.repository.ApplicationRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
@DataJpaTest(properties = {
    "application-events.topic=application-events-it",
    "application-events.publish-delay-ms=3600000",
    "application-events.publish-initial-delay-ms=3600000",
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
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@ImportAutoConfiguration(KafkaAutoConfiguration.class)
@Import({
    ApplicationPipelineService.class,
    ApplicationHistoryWriter.class,
    ApplicationOutboxPublisher.class,
    ApplicationOutboxKafkaIT.TestJacksonConfiguration.class
})
class ApplicationOutboxKafkaIT {
    private static final String TOPIC = "application-events-it";
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final String AUTHORIZATION = "Bearer kafka-integration";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("recruitment")
            .withUsername("recruitment")
            .withPassword("recruitment");

    @Container
    static final KafkaContainer KAFKA =
        new KafkaContainer("apache/kafka-native:3.8.0");

    @DynamicPropertySource
    static void serviceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add(
            "spring.kafka.bootstrap-servers",
            KAFKA::getBootstrapServers
        );
    }

    @Autowired
    private ApplicationPipelineService pipeline;

    @Autowired
    private ApplicationOutboxPublisher publisher;

    @Autowired
    private ApplicationRepository applications;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private CompanyClient companies;

    @BeforeEach
    void setUp() throws Exception {
        jdbc.execute(
            """
            TRUNCATE TABLE
                application.application_event_outbox,
                application.application_history,
                application.bookmarks,
                application.applications
            CASCADE
            """
        );
        when(companies.getRecruiterCompanyId(
            any(UUID.class),
            anyString()
        )).thenReturn(COMPANY_ID);
        createTopic();
    }

    @Test
    void statusChangedReachesKafkaOnceAndPublishedOutboxIsSkipped()
        throws Exception {
        UUID applicationId = saveAppliedApplication();

        try (KafkaConsumer<String, String> consumer = createConsumer()) {
            consumer.subscribe(List.of(TOPIC));
            awaitAssignment(consumer);

            pipeline.changeStatus(
                applicationId,
                RECRUITER_ID,
                AUTHORIZATION,
                new ChangeApplicationStatusRequest(
                    ApplicationStatus.REVIEWING,
                    "Ready for Kafka delivery",
                    0L
                )
            );

            Integer pendingEvents = jdbc.queryForObject(
                """
                SELECT COUNT(*)
                FROM application.application_event_outbox
                WHERE aggregate_id = ? AND published_at IS NULL
                """,
                Integer.class,
                applicationId
            );
            assertThat(pendingEvents).isEqualTo(1);

            publisher.publishPending();

            ConsumerRecord<String, String> received = receiveOne(consumer);
            JsonNode payload = objectMapper.readTree(received.value());
            Map<String, Object> published = jdbc.queryForMap(
                """
                SELECT id, event_key, topic, payload,
                       attempts, published_at, last_error
                FROM application.application_event_outbox
                WHERE aggregate_id = ?
                """,
                applicationId
            );

            assertThat(received.topic()).isEqualTo(TOPIC);
            assertThat(received.key()).isEqualTo(applicationId.toString());
            assertThat(received.value()).isEqualTo(published.get("payload"));
            assertThat(payload.path("action").asText())
                .isEqualTo("STATUS_CHANGED");
            assertThat(payload.path("application_id").asText())
                .isEqualTo(applicationId.toString());
            assertThat(payload.path("from_status").asText())
                .isEqualTo("APPLIED");
            assertThat(payload.path("to_status").asText())
                .isEqualTo("REVIEWING");
            assertThat(payload.path("event_id").asText())
                .isEqualTo(published.get("id").toString());

            assertThat(published)
                .containsEntry("event_key", applicationId)
                .containsEntry("topic", TOPIC)
                .containsEntry("attempts", 0)
                .containsEntry("last_error", null);
            assertThat(published.get("published_at")).isNotNull();

            publisher.publishPending();

            ConsumerRecords<String, String> duplicates = consumer.poll(
                Duration.ofSeconds(2)
            );
            assertThat(duplicates.isEmpty()).isTrue();
        }
    }

    private void createTopic() throws Exception {
        Map<String, Object> properties = Map.of(
            AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG,
            KAFKA.getBootstrapServers()
        );
        try (AdminClient admin = AdminClient.create(properties)) {
            admin.createTopics(List.of(new NewTopic(TOPIC, 1, (short) 1)))
                .all()
                .get(15, TimeUnit.SECONDS);
        }
    }

    private KafkaConsumer<String, String> createConsumer() {
        Map<String, Object> properties = new HashMap<>();
        properties.put(
            ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG,
            KAFKA.getBootstrapServers()
        );
        properties.put(
            ConsumerConfig.GROUP_ID_CONFIG,
            "application-outbox-it-" + UUID.randomUUID()
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
        Instant deadline = Instant.now().plusSeconds(15);
        while (consumer.assignment().isEmpty() &&
            Instant.now().isBefore(deadline)) {
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
        assertThat(records.count()).isEqualTo(1);
        return records.iterator().next();
    }

    private UUID saveAppliedApplication() {
        UUID applicationId = UUID.randomUUID();
        applications.saveAndFlush(ApplicationEntity.applied(
            applicationId,
            UUID.randomUUID(),
            COMPANY_ID,
            UUID.randomUUID(),
            RECRUITER_ID,
            UUID.randomUUID(),
            "Backend Engineer",
            "Kafka integration candidate",
            ApplicationSource.SEARCH,
            Instant.parse("2026-08-25T00:00:00Z")
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
