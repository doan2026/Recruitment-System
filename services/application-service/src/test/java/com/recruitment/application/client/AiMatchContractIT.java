package com.recruitment.application.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.config.ClientConfig;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.ImageFromDockerfile;

/**
 * Cross-service contract gate between Application Service and AI Service.
 *
 * <p>Both services belong to the same owner, so this exercises the real
 * {@code /match} provider rather than a stub: the AI Service image is built
 * from its own Dockerfile, runs its own Alembic migrations against a real
 * pgvector database, and answers the same {@link AiClient} the production code
 * uses. A drift on either side — request field names, response envelope,
 * score scaling, or a not-ready reason — fails here instead of surfacing as a
 * wrong match score in production.</p>
 *
 * <p>Vectors are seeded directly so the assertions are exact. This gate is
 * about the HTTP contract and the score arithmetic, not about embedding
 * quality, which stays a separate real-model concern.</p>
 */
class AiMatchContractIT {
    private static final String INTERNAL_API_KEY =
        "application-ai-contract-internal-key-0001";
    private static final String MODEL_NAME = "contract-test-model-v1";
    private static final String TEXT_HASH = "a".repeat(64);
    private static final int DIMENSIONS = 384;

    /**
     * The AI Service image is built from its sibling module, so this gate only
     * runs from a full repository checkout. Resolving the context absolutely
     * keeps it independent of how the module was invoked.
     */
    private static final Path AI_SERVICE_CONTEXT = Path.of("")
        .toAbsolutePath()
        .getParent()
        .resolve("ai-service")
        .normalize();

    private static final Network NETWORK = Network.newNetwork();

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("pgvector/pgvector:pg16")
            .withDatabaseName("ai_contract")
            .withUsername("ai_contract")
            .withPassword("ai_contract_password")
            .withNetwork(NETWORK)
            .withNetworkAliases("ai-postgres");

    @SuppressWarnings("resource")
    private static final GenericContainer<?> AI_SERVICE =
        new GenericContainer<>(
            new ImageFromDockerfile()
                .withFileFromPath(".", AI_SERVICE_CONTEXT)
                .withTarget("runtime")
        )
            .withNetwork(NETWORK)
            .withEnv(
                "DATABASE_URL",
                "postgresql://ai_contract:ai_contract_password"
                    + "@ai-postgres:5432/ai_contract"
            )
            .withEnv("INTERNAL_API_KEY", INTERNAL_API_KEY)
            // The provider refuses to start without its distinct scoped keys,
            // even though this gate only exercises the /match surface.
            .withEnv(
                "INTERNAL_API_KEY_JOB_SEARCH",
                "application-ai-contract-job-search-key-0001"
            )
            .withEnv(
                "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES",
                "application-ai-contract-candidates-key-0001"
            )
            .withEnv("CHAT_ENABLED", "false")
            .withExposedPorts(8000)
            .waitingFor(
                Wait.forHttp("/health")
                    .forStatusCode(200)
                    .withStartupTimeout(Duration.ofMinutes(3))
            );

    private static JdbcTemplate jdbc;
    private static AiClient client;

    @BeforeAll
    static void startServices() {
        if (!Files.isDirectory(AI_SERVICE_CONTEXT.resolve("app"))) {
            throw new IllegalStateException(
                "AI Service sources are required to build the provider image: "
                    + AI_SERVICE_CONTEXT
            );
        }
        POSTGRES.start();
        AI_SERVICE.start();
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
            POSTGRES.getJdbcUrl(),
            POSTGRES.getUsername(),
            POSTGRES.getPassword()
        ));
        // The production customizer supplies the request factory, so this gate
        // exercises the same wire behaviour the deployed service uses.
        client = new AiClient(productionBuilder(), baseUrl(), INTERNAL_API_KEY);
    }

    private static RestClient.Builder productionBuilder() {
        RestClient.Builder builder = RestClient.builder();
        new ClientConfig().restClientTimeoutCustomizer().customize(builder);
        return builder;
    }

    private static String baseUrl() {
        return "http://"
            + AI_SERVICE.getHost()
            + ":"
            + AI_SERVICE.getMappedPort(8000);
    }

    @AfterAll
    static void stopServices() {
        AI_SERVICE.stop();
        POSTGRES.stop();
        NETWORK.close();
    }

    @Test
    void theProviderAnswersTheDocumentedEnvelopeOverRawHttp() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(unit(0), true);

        var response = productionBuilder()
            .baseUrl(baseUrl())
            .build()
            .post()
            .uri("/match")
            .header("X-Internal-Api-Key", INTERNAL_API_KEY)
            .header("Content-Type", "application/json")
            .body(
                "{\"cv_id\":\"" + cvId + "\",\"job_id\":\"" + jobId + "\"}"
            )
            .retrieve()
            .toEntity(String.class);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody())
            .contains("\"cv_id\":\"" + cvId + "\"")
            .contains("\"job_id\":\"" + jobId + "\"")
            .contains("\"score\":1.0")
            .contains("\"meta\":null");
    }

    @Test
    void identicalVectorsScoreOneThroughTheRealProvider() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(unit(0), true);

        BigDecimal score = client.getMatchScore(cvId, jobId);

        // cosine 1 maps to (1 + 1) / 2 = 1, reported as a whole percentage.
        assertThat(score).isEqualByComparingTo(new BigDecimal("100.00"));
    }

    @Test
    void orthogonalVectorsLandOnTheMidpointOfTheScale() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(unit(1), true);

        BigDecimal score = client.getMatchScore(cvId, jobId);

        // cosine 0 maps to (0 + 1) / 2 = 0.5; the client never clamps it away.
        assertThat(score).isEqualByComparingTo(new BigDecimal("50.00"));
    }

    @Test
    void oppositeVectorsReachTheBottomOfTheScale() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(negated(unit(0)), true);

        BigDecimal score = client.getMatchScore(cvId, jobId);

        // cosine -1 maps to 0; this is the case a clamp would silently hide.
        assertThat(score).isEqualByComparingTo(new BigDecimal("0.00"));
    }

    @Test
    void aMissingCvEmbeddingIsReportedAsNotReadyRatherThanZero() {
        UUID jobId = seedJob(unit(0), true);

        assertThatThrownBy(() -> client.getMatchScore(UUID.randomUUID(), jobId))
            .isInstanceOfSatisfying(BusinessException.class, business -> {
                assertThat(business.code()).isEqualTo("AI_MATCH_NOT_READY");
                assertThat(business.status()).isEqualTo(HttpStatus.CONFLICT);
                assertThat(business.details())
                    .containsEntry("reason", "CV_EMBEDDING_NOT_FOUND");
            });
    }

    @Test
    void aMissingJobEmbeddingIsReportedAsNotReady() {
        UUID cvId = seedCv(unit(0));

        assertThatThrownBy(() -> client.getMatchScore(cvId, UUID.randomUUID()))
            .isInstanceOfSatisfying(BusinessException.class, business ->
                assertThat(business.details())
                    .containsEntry("reason", "JOB_EMBEDDING_NOT_FOUND")
            );
    }

    @Test
    void aDeactivatedJobIsIndistinguishableFromAMissingEmbedding() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(unit(0), false);

        assertThatThrownBy(() -> client.getMatchScore(cvId, jobId))
            .isInstanceOfSatisfying(BusinessException.class, business ->
                // A closed job must not leak that it still has a stored vector.
                assertThat(business.details())
                    .containsEntry("reason", "JOB_EMBEDDING_NOT_FOUND")
            );
    }

    @Test
    void aModelMismatchIsRefusedInsteadOfComparedAcrossSpaces() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(unit(0), true);
        jdbc.update(
            "UPDATE ai.job_embeddings SET model_name = ? WHERE job_id = ?",
            "another-model-v9",
            jobId
        );

        assertThatThrownBy(() -> client.getMatchScore(cvId, jobId))
            .isInstanceOfSatisfying(BusinessException.class, business ->
                assertThat(business.details())
                    .containsEntry("reason", "EMBEDDING_MODEL_MISMATCH")
            );
    }

    @Test
    void aWrongInternalKeyIsRejectedWithoutRevealingTheStore() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(unit(0), true);
        AiClient impostor = new AiClient(
            productionBuilder(),
            baseUrl(),
            "wrong-internal-key-000000000000000000"
        );

        assertThatThrownBy(() -> impostor.getMatchScore(cvId, jobId))
            .isInstanceOfSatisfying(BusinessException.class, business -> {
                assertThat(business.code())
                    .isEqualTo("AI_SERVICE_INVALID_RESPONSE");
                assertThat(business.status())
                    .isEqualTo(HttpStatus.BAD_GATEWAY);
            });
    }

    @Test
    void theProviderEchoesTheExactPairItWasAskedAbout() {
        UUID cvId = seedCv(unit(0));
        UUID jobId = seedJob(unit(2), true);
        UUID otherJobId = seedJob(unit(0), true);

        BigDecimal asked = client.getMatchScore(cvId, jobId);
        BigDecimal other = client.getMatchScore(cvId, otherJobId);

        // Distinct pairs must produce distinct scores, so a swapped or echoed
        // identifier cannot go unnoticed.
        assertThat(asked).isEqualByComparingTo(new BigDecimal("50.00"));
        assertThat(other).isEqualByComparingTo(new BigDecimal("100.00"));
    }

    @Test
    void anUnreachableProviderFailsClosedAsUnavailable() {
        AiClient unreachable = new AiClient(
            productionBuilder(),
            "http://127.0.0.1:1",
            INTERNAL_API_KEY
        );

        assertThatThrownBy(() ->
            unreachable.getMatchScore(UUID.randomUUID(), UUID.randomUUID())
        )
            .isInstanceOfSatisfying(BusinessException.class, business -> {
                assertThat(business.code())
                    .isEqualTo("AI_SERVICE_UNAVAILABLE");
                assertThat(business.status())
                    .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            });
    }

    @Test
    void repeatedCallsOverTheSameStateAreStable() {
        UUID cvId = seedCv(unit(3));
        UUID jobId = seedJob(unit(3), true);

        List<BigDecimal> scores = new ArrayList<>();
        for (int attempt = 0; attempt < 5; attempt++) {
            scores.add(client.getMatchScore(cvId, jobId));
        }

        assertThat(scores)
            .allSatisfy(score ->
                assertThat(score)
                    .isEqualByComparingTo(new BigDecimal("100.00"))
            );
    }

    private UUID seedCv(double[] vector) {
        UUID cvId = UUID.randomUUID();
        jdbc.update(
            """
            INSERT INTO ai.cv_embeddings (
                cv_id, user_id, vector, text_hash, model_name
            ) VALUES (?, ?, ?::vector, ?, ?)
            """,
            cvId,
            UUID.randomUUID(),
            literal(vector),
            TEXT_HASH,
            MODEL_NAME
        );
        return cvId;
    }

    private UUID seedJob(double[] vector, boolean active) {
        UUID jobId = UUID.randomUUID();
        jdbc.update(
            """
            INSERT INTO ai.job_embeddings (
                job_id, vector, text_hash, model_name, is_active
            ) VALUES (?, ?::vector, ?, ?, ?)
            """,
            jobId,
            literal(vector),
            TEXT_HASH,
            MODEL_NAME,
            active
        );
        return jobId;
    }

    /** A unit basis vector, so every expected cosine is exact. */
    private static double[] unit(int axis) {
        double[] vector = new double[DIMENSIONS];
        vector[axis] = 1.0;
        return vector;
    }

    private static double[] negated(double[] vector) {
        double[] negated = new double[vector.length];
        for (int index = 0; index < vector.length; index++) {
            negated[index] = -vector[index];
        }
        return negated;
    }

    private static String literal(double[] vector) {
        return IntStream.range(0, vector.length)
            .mapToObj(index -> String.valueOf(vector[index]))
            .collect(Collectors.joining(",", "[", "]"));
    }
}
