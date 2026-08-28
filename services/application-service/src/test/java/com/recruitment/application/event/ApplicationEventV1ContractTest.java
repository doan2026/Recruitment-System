package com.recruitment.application.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.domain.OfferStatus;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class ApplicationEventV1ContractTest {
    private static final ObjectMapper OBJECT_MAPPER =
        new ObjectMapper()
            .findAndRegisterModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    private static final UUID APPLICATION_ID = UUID.fromString(
        "22222222-2222-4222-8222-222222222222"
    );
    private static final UUID JOB_ID = UUID.fromString(
        "33333333-3333-4333-8333-333333333333"
    );
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "44444444-4444-4444-8444-444444444444"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "55555555-5555-4555-8555-555555555555"
    );
    private static final UUID OFFER_ID = UUID.fromString(
        "66666666-6666-4666-8666-666666666666"
    );
    private static final ApplicationEntity APPLICATION =
        ApplicationEntity.applied(
            APPLICATION_ID,
            JOB_ID,
            UUID.fromString("77777777-7777-4777-8777-777777777777"),
            CANDIDATE_ID,
            RECRUITER_ID,
            UUID.fromString("88888888-8888-4888-8888-888888888888"),
            "Backend Engineer",
            null,
            ApplicationSource.SEARCH,
            Instant.parse("2026-08-28T07:00:00Z")
        );
    private static Path contractDirectory;

    @BeforeAll
    static void locateContract() {
        Path current = Path.of("").toAbsolutePath().normalize();
        while (current != null) {
            Path direct = current.resolve("contracts/events");
            if (Files.isRegularFile(
                direct.resolve("application-events.v1.schema.json")
            )) {
                contractDirectory = direct;
                return;
            }
            Path repositoryLayout = current.resolve(
                "services/application-service/contracts/events"
            );
            if (Files.isRegularFile(
                repositoryLayout.resolve("application-events.v1.schema.json")
            )) {
                contractDirectory = repositoryLayout;
                return;
            }
            current = current.getParent();
        }
        throw new IllegalStateException(
            "application-events v1 contract artifact was not found"
        );
    }

    @Test
    void schemaLocksTheVersionedCommonAndOfferFields() throws Exception {
        JsonNode schema = read(
            contractDirectory.resolve("application-events.v1.schema.json")
        );

        assertThat(schema.path("$schema").asText())
            .isEqualTo("https://json-schema.org/draft/2020-12/schema");
        assertThat(schema.path("properties").fieldNames())
            .toIterable()
            .containsExactlyInAnyOrderElementsOf(Set.of(
                "schema_version",
                "event_id",
                "action",
                "application_id",
                "job_id",
                "job_title",
                "candidate_id",
                "recruiter_id",
                "actor_id",
                "from_status",
                "to_status",
                "aggregate_version",
                "occurred_at",
                "offer_id",
                "offer_status",
                "offer_version"
            ));
        assertThat(schema.path("required").size()).isEqualTo(13);
        assertThat(schema.path("properties").path("schema_version")
            .path("const").asInt()).isEqualTo(1);
        assertThat(schema.path("properties").path("aggregate_version")
            .path("maximum").asLong()).isEqualTo(9_007_199_254_740_991L);
        assertThat(schema.path("properties").path("occurred_at")
            .path("pattern").asText()).endsWith("Z$");
        assertThat(schema.path("allOf").path(1).path("then")
            .path("oneOf").size()).isEqualTo(2);
        assertThat(schema.path("additionalProperties").asBoolean()).isFalse();
    }

    @Test
    void submittedFixtureMatchesTheCanonicalProducer() throws Exception {
        Map<String, Object> event = ApplicationEventV1.base(
            UUID.fromString("11111111-1111-4111-8111-111111111111"),
            ApplicationEventV1.Action.STATUS_CHANGED,
            APPLICATION,
            CANDIDATE_ID,
            null,
            ApplicationStatus.APPLIED,
            0,
            Instant.parse("2026-08-28T08:00:01Z")
        );

        assertFixture("status-changed-submitted.json", event);
    }

    @Test
    void pipelineFixtureMatchesTheCanonicalProducer() throws Exception {
        Map<String, Object> event = ApplicationEventV1.base(
            UUID.fromString("11111111-1111-4111-8111-111111111112"),
            ApplicationEventV1.Action.STATUS_CHANGED,
            APPLICATION,
            RECRUITER_ID,
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            1,
            Instant.parse("2026-08-28T08:05:01Z")
        );

        assertFixture("status-changed-pipeline.json", event);
    }

    @Test
    void offerSentFixtureMatchesTheCanonicalProducer() throws Exception {
        Map<String, Object> event = ApplicationEventV1.base(
            UUID.fromString("11111111-1111-4111-8111-111111111113"),
            ApplicationEventV1.Action.OFFER_SENT,
            APPLICATION,
            RECRUITER_ID,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            5,
            Instant.parse("2026-08-28T09:00:01Z")
        );
        event.put("offer_id", OFFER_ID);
        event.put("offer_status", OfferStatus.SENT);
        event.put("offer_version", 0L);

        assertFixture("offer-sent.json", event);
    }

    @Test
    void offerAcceptedFixtureMatchesTheCanonicalProducer() throws Exception {
        Map<String, Object> event = ApplicationEventV1.base(
            UUID.fromString("11111111-1111-4111-8111-111111111114"),
            ApplicationEventV1.Action.STATUS_CHANGED,
            APPLICATION,
            CANDIDATE_ID,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED,
            6,
            Instant.parse("2026-08-28T10:00:01Z")
        );
        event.put("offer_id", OFFER_ID);
        event.put("offer_status", OfferStatus.ACCEPTED);
        event.put("offer_version", 1L);

        assertFixture("offer-accepted.json", event);
    }

    @Test
    void retainsNullableActorForFutureSystemActions() {
        Map<String, Object> event = ApplicationEventV1.base(
            UUID.randomUUID(),
            ApplicationEventV1.Action.STATUS_CHANGED,
            APPLICATION,
            null,
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            1,
            Instant.parse("2026-08-28T08:05:01Z")
        );

        assertThat(event).containsEntry("actor_id", null);
    }

    @Test
    void rejectsANegativeResultingAggregateVersion() {
        assertThatThrownBy(() -> ApplicationEventV1.base(
            UUID.randomUUID(),
            ApplicationEventV1.Action.STATUS_CHANGED,
            APPLICATION,
            RECRUITER_ID,
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            -1,
            Instant.parse("2026-08-28T08:05:01Z")
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage(
                "aggregateVersion must be a non-negative JSON-safe integer"
            );
    }

    @Test
    void rejectsAnAggregateVersionThatJsonCannotRepresentExactly() {
        assertThatThrownBy(() -> ApplicationEventV1.base(
            UUID.randomUUID(),
            ApplicationEventV1.Action.STATUS_CHANGED,
            APPLICATION,
            RECRUITER_ID,
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            9_007_199_254_740_992L,
            Instant.parse("2026-08-28T08:05:01Z")
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage(
                "aggregateVersion must be a non-negative JSON-safe integer"
            );
    }

    private void assertFixture(
        String fixtureName,
        Map<String, Object> produced
    ) throws Exception {
        JsonNode fixture = read(
            contractDirectory.resolve("fixtures/application-events-v1")
                .resolve(fixtureName)
        );
        JsonNode actual = OBJECT_MAPPER.readTree(
            OBJECT_MAPPER.writeValueAsBytes(produced)
        );
        assertThat(actual).isEqualTo(fixture);
    }

    private static JsonNode read(Path path) throws IOException {
        return OBJECT_MAPPER.readTree(path.toFile());
    }
}
