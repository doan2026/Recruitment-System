package com.recruitment.application.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.recruitment.application.api.BusinessException;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.ResponseActions;
import org.springframework.web.client.RestClient;

class AiClientTest {
    private static final String BASE_URL = "http://ai-service:8000";
    private static final String INTERNAL_API_KEY = "shared-internal-key";
    private static final UUID CV_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID JOB_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );

    private MockRestServiceServer server;
    private AiClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        client = new AiClient(builder, BASE_URL, INTERNAL_API_KEY);
    }

    @Test
    void sendsTheInternalContractAndConvertsScoreToRoundedPercent() {
        expectRequest().andRespond(success("0.85456", null));

        BigDecimal score = client.getMatchScore(CV_ID, JOB_ID);

        assertThat(score).isEqualByComparingTo("85.46");
        assertThat(score.scale()).isEqualTo(2);
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "1"})
    void acceptsContractBoundaries(String rawScore) {
        expectRequest().andRespond(success(rawScore, null));

        BigDecimal score = client.getMatchScore(CV_ID, JOB_ID);

        assertThat(score).isEqualByComparingTo(
            new BigDecimal(rawScore).movePointRight(2)
        );
        assertThat(score.scale()).isEqualTo(2);
        server.verify();
    }

    @Test
    void missingEmbeddingMapsToNotReadyWithReason() {
        expectRequest().andRespond(success(
            null,
            "CV_EMBEDDING_NOT_FOUND"
        ));

        BusinessException error = assertBusinessError(
            () -> client.getMatchScore(CV_ID, JOB_ID),
            "AI_MATCH_NOT_READY",
            HttpStatus.CONFLICT
        );
        assertThat(error.details())
            .containsEntry("reason", "CV_EMBEDDING_NOT_FOUND");
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(ints = {429, 500, 503})
    void transientDownstreamFailureMapsToUnavailable(int status) {
        expectRequest().andRespond(withStatus(HttpStatus.valueOf(status)));

        assertBusinessError(
            () -> client.getMatchScore(CV_ID, JOB_ID),
            "AI_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 422})
    void downstreamContractErrorsMapToInvalidResponse(int status) {
        expectRequest().andRespond(withStatus(HttpStatus.valueOf(status)));

        assertInvalidResponse();
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"-0.0001", "1.0001"})
    void outOfRangeScoreIsRejected(String score) {
        expectRequest().andRespond(success(score, null));

        assertInvalidResponse();
        server.verify();
    }

    @Test
    void mismatchedEchoedIdentityIsRejected() {
        expectRequest().andRespond(withSuccess(
            envelope(OTHER_ID, JOB_ID, "0.85", null),
            MediaType.APPLICATION_JSON
        ));

        assertInvalidResponse();
        server.verify();
    }

    @Test
    void scoreAndReasonTogetherAreRejectedAsContradictory() {
        expectRequest().andRespond(success("0.85", "STALE_EMBEDDING"));

        assertInvalidResponse();
        server.verify();
    }

    @Test
    void missingDataIsRejected() {
        expectRequest().andRespond(withSuccess(
            "{\"data\":null,\"meta\":null}",
            MediaType.APPLICATION_JSON
        ));

        assertInvalidResponse();
        server.verify();
    }

    @Test
    void missingScoreAndReasonIsRejected() {
        expectRequest().andRespond(success(null, null));

        assertInvalidResponse();
        server.verify();
    }

    @Test
    void malformedJsonIsRejected() {
        expectRequest().andRespond(withSuccess(
            "{\"data\":",
            MediaType.APPLICATION_JSON
        ));

        assertInvalidResponse();
        server.verify();
    }

    private ResponseActions expectRequest() {
        return server.expect(requestTo(BASE_URL + "/match"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("X-Internal-Api-Key", INTERNAL_API_KEY))
            .andExpect(content().json("""
                {
                  "cv_id": "%s",
                  "job_id": "%s"
                }
                """.formatted(CV_ID, JOB_ID)));
    }

    private org.springframework.test.web.client.ResponseCreator success(
        String score,
        String reason
    ) {
        return withSuccess(
            envelope(CV_ID, JOB_ID, score, reason),
            MediaType.APPLICATION_JSON
        );
    }

    private String envelope(
        UUID cvId,
        UUID jobId,
        String score,
        String reason
    ) {
        String scoreJson = score == null ? "null" : score;
        String reasonJson = reason == null
            ? "null"
            : "\"" + reason + "\"";
        return """
            {
              "data": {
                "cv_id": "%s",
                "job_id": "%s",
                "score": %s,
                "reason": %s,
                "ignored_future_field": true
              },
              "meta": null
            }
            """.formatted(cvId, jobId, scoreJson, reasonJson);
    }

    private void assertInvalidResponse() {
        assertBusinessError(
            () -> client.getMatchScore(CV_ID, JOB_ID),
            "AI_SERVICE_INVALID_RESPONSE",
            HttpStatus.BAD_GATEWAY
        );
    }

    private BusinessException assertBusinessError(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
        String code,
        HttpStatus status
    ) {
        BusinessException error = catchThrowableOfType(
            call,
            BusinessException.class
        );
        assertThat(error).isNotNull();
        assertThat(error.code()).isEqualTo(code);
        assertThat(error.status()).isEqualTo(status);
        return error;
    }
}
