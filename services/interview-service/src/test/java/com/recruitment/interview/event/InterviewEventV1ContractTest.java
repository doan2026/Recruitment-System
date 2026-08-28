package com.recruitment.interview.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.domain.InterviewMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class InterviewEventV1ContractTest {
    private static final ObjectMapper OBJECT_MAPPER =
        new ObjectMapper().findAndRegisterModules();
    private static final UUID EVENT_ID = UUID.fromString(
        "11111111-1111-4111-8111-111111111111"
    );
    private static final UUID INTERVIEW_ID = UUID.fromString(
        "22222222-2222-4222-8222-222222222222"
    );
    private static final UUID APPLICATION_ID = UUID.fromString(
        "33333333-3333-4333-8333-333333333333"
    );
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "44444444-4444-4444-8444-444444444444"
    );
    private static final UUID INTERVIEWER_ID = UUID.fromString(
        "55555555-5555-4555-8555-555555555555"
    );
    private static Path contractDirectory;

    @BeforeAll
    static void locateContract() {
        Path current = Path.of("").toAbsolutePath().normalize();
        while (current != null) {
            Path direct = current.resolve("contracts/events");
            if (Files.isRegularFile(
                direct.resolve("interview-events.v1.schema.json")
            )) {
                contractDirectory = direct;
                return;
            }
            Path repositoryLayout = current.resolve(
                "services/interview-service/contracts/events"
            );
            if (Files.isRegularFile(
                repositoryLayout.resolve("interview-events.v1.schema.json")
            )) {
                contractDirectory = repositoryLayout;
                return;
            }
            current = current.getParent();
        }
        throw new IllegalStateException(
            "interview-events v1 contract artifact was not found"
        );
    }

    @Test
    void schemaLocksExactFoundationFieldsAndPrivacyBoundary()
        throws Exception {
        JsonNode schema = OBJECT_MAPPER.readTree(
            contractDirectory.resolve(
                "interview-events.v1.schema.json"
            ).toFile()
        );
        Set<String> exactFields = Set.of(
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
        );

        assertThat(schema.path("properties").fieldNames())
            .toIterable()
            .containsExactlyInAnyOrderElementsOf(exactFields);
        assertThat(schema.path("required")).hasSize(exactFields.size());
        assertThat(schema.path("additionalProperties").asBoolean()).isFalse();
        assertThat(schema.path("properties").path("action")
            .path("const").asText()).isEqualTo("SCHEDULED");
        assertThat(schema.path("properties").path("status")
            .path("const").asText()).isEqualTo("SCHEDULED");
        assertThat(schema.path("properties").fieldNames())
            .toIterable()
            .doesNotContain(
                "room_url",
                "join_token",
                "location",
                "notes",
                "request_id",
                "request_hash",
                "feedback"
            );
    }

    @Test
    void scheduledFixtureMatchesCanonicalProducerExactly() throws Exception {
        InterviewEntity interview = InterviewEntity.schedule(
            INTERVIEW_ID,
            APPLICATION_ID,
            7,
            "REVIEWING",
            UUID.fromString("66666666-6666-4666-8666-666666666666"),
            UUID.fromString("77777777-7777-4777-8777-777777777777"),
            CANDIDATE_ID,
            INTERVIEWER_ID,
            UUID.fromString("88888888-8888-4888-8888-888888888888"),
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            1,
            Instant.parse("2026-09-10T02:00:00Z"),
            Instant.parse("2026-09-10T02:45:00Z"),
            "Asia/Ho_Chi_Minh",
            45,
            InterviewMode.OFFLINE,
            "Private meeting room",
            "Internal recruiter note",
            Instant.parse("2026-08-28T14:20:00Z")
        );
        Map<String, Object> produced = InterviewEventV1.scheduled(
            EVENT_ID,
            interview,
            interview.getCreatedAt()
        );
        JsonNode fixture = OBJECT_MAPPER.readTree(
            contractDirectory.resolve(
                "fixtures/interview-events-v1/scheduled.json"
            ).toFile()
        );

        JsonNode actual = OBJECT_MAPPER.readTree(
            OBJECT_MAPPER.writeValueAsBytes(produced)
        );
        assertThat(actual).isEqualTo(fixture);
        assertThat(produced)
            .doesNotContainKeys("location", "notes", "room_url");
        assertThatThrownBy(() -> InterviewEventV1.scheduled(
            UUID.fromString("11111111-1111-1111-8111-111111111111"),
            interview,
            interview.getCreatedAt()
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("UUIDv4");
    }
}
