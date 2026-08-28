package com.recruitment.interview.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.interview.api.BusinessException;
import java.net.URI;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ApplicationClientTest {
    private static final String BASE_URL = "https://application-service";
    private static final String AUTHORIZE_PATH =
        "/internal/v1/interview-scheduling/authorize";
    private static final String INTERNAL_API_KEY =
        "test-internal-api-key-with-at-least-32-bytes";
    private static final String BEARER_TOKEN = "Bearer recruiter-access-token";

    private static final UUID APPLICATION_ID = UUID.fromString(
        "11111111-1111-1111-1111-111111111111"
    );
    private static final UUID OTHER_APPLICATION_ID = UUID.fromString(
        "22222222-2222-2222-2222-222222222222"
    );
    private static final UUID JOB_ID = UUID.fromString(
        "33333333-3333-3333-3333-333333333333"
    );
    private static final UUID COMPANY_ID = UUID.fromString(
        "44444444-4444-4444-4444-444444444444"
    );
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "55555555-5555-5555-5555-555555555555"
    );

    private MockRestServiceServer server;
    private ApplicationClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
        server = MockRestServiceServer.bindTo(builder).build();
        client = new ApplicationClient(
            builder.build(),
            new ObjectMapper(),
            INTERNAL_API_KEY
        );
    }

    @AfterEach
    void verifyServer() {
        server.verify();
    }

    @Test
    void authorizeSchedulingSendsExactContractAndReturnsContext() {
        server.expect(once(), requestTo(BASE_URL + AUTHORIZE_PATH))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header(
                HttpHeaders.CONTENT_TYPE,
                MediaType.APPLICATION_JSON_VALUE
            ))
            .andExpect(header(
                HttpHeaders.ACCEPT,
                MediaType.APPLICATION_JSON_VALUE
            ))
            .andExpect(header("X-Internal-Service", "interview-service"))
            .andExpect(header("X-Internal-Api-Key", INTERNAL_API_KEY))
            .andExpect(header(HttpHeaders.AUTHORIZATION, BEARER_TOKEN))
            .andExpect(content().string(
                "{\"applicationId\":\"" + APPLICATION_ID + "\"}"
            ))
            .andRespond(withSuccess(
                validEnvelope(APPLICATION_ID),
                MediaType.APPLICATION_JSON
            ));

        ApplicationAuthorizationContext result = client.authorizeScheduling(
            APPLICATION_ID,
            BEARER_TOKEN
        );

        assertThat(result).isEqualTo(new ApplicationAuthorizationContext(
            APPLICATION_ID,
            JOB_ID,
            COMPANY_ID,
            CANDIDATE_ID,
            "REVIEWING",
            7L
        ));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("businessErrorResponses")
    void mapsApplicationServiceBusinessErrors(
        String description,
        HttpStatus upstreamStatus,
        String expectedCode,
        HttpStatus expectedStatus
    ) {
        expectResponse(upstreamStatus, "{}");

        assertBusinessError(expectedCode, expectedStatus);
    }

    private static Stream<Arguments> businessErrorResponses() {
        return Stream.of(
            Arguments.of(
                "403 is access denied",
                HttpStatus.FORBIDDEN,
                "APPLICATION_ACCESS_DENIED",
                HttpStatus.FORBIDDEN
            ),
            Arguments.of(
                "404 is not found",
                HttpStatus.NOT_FOUND,
                "APPLICATION_NOT_FOUND",
                HttpStatus.NOT_FOUND
            ),
            Arguments.of(
                "409 is not schedulable",
                HttpStatus.CONFLICT,
                "APPLICATION_NOT_SCHEDULABLE",
                HttpStatus.CONFLICT
            )
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("serverErrorResponses")
    void mapsEveryServerErrorToUnavailable(
        String description,
        HttpStatus upstreamStatus
    ) {
        expectResponse(upstreamStatus, "upstream failure");

        assertUnavailable();
    }

    private static Stream<Arguments> serverErrorResponses() {
        return Stream.of(
            Arguments.of("500", HttpStatus.INTERNAL_SERVER_ERROR),
            Arguments.of("502", HttpStatus.BAD_GATEWAY),
            Arguments.of("503", HttpStatus.SERVICE_UNAVAILABLE)
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidJsonResponses")
    void rejectsMalformedUnknownOrMismatchedJson(
        String description,
        String responseBody
    ) {
        server.expect(once(), requestTo(BASE_URL + AUTHORIZE_PATH))
            .andRespond(withSuccess(responseBody, MediaType.APPLICATION_JSON));

        assertUnavailable();
    }

    private static Stream<Arguments> invalidJsonResponses() {
        return Stream.of(
            Arguments.of("malformed JSON", "{"),
            Arguments.of(
                "unknown envelope field",
                validEnvelopeWithUnknownEnvelopeField()
            ),
            Arguments.of(
                "unknown context field",
                validEnvelopeWithUnknownContextField()
            ),
            Arguments.of(
                "mismatched application id",
                validEnvelope(OTHER_APPLICATION_ID)
            )
        );
    }

    @Test
    void rejectsJsonBodyWithWrongContentType() {
        server.expect(once(), requestTo(BASE_URL + AUTHORIZE_PATH))
            .andRespond(withSuccess(
                validEnvelope(APPLICATION_ID),
                MediaType.TEXT_PLAIN
            ));

        assertUnavailable();
    }

    @Test
    void rejectsResponseLargerThanLimit() {
        String oversizedBody = " ".repeat(
            ApplicationClient.MAX_RESPONSE_BYTES + 1
        );
        server.expect(once(), requestTo(BASE_URL + AUTHORIZE_PATH))
            .andRespond(withSuccess(
                oversizedBody,
                MediaType.APPLICATION_JSON
            ));

        assertUnavailable();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("disallowedBaseUrls")
    void validateBaseUrlRejectsNonOriginOrUntrustedUrls(
        String description,
        String baseUrl
    ) {
        assertThatThrownBy(() -> ApplicationClient.validateBaseUrl(
            baseUrl,
            "application-service,application-service-backup"
        ))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage(
                "APPLICATION_SERVICE_URL must be an allowlisted HTTP(S) origin"
            );
    }

    private static Stream<Arguments> disallowedBaseUrls() {
        return Stream.of(
            Arguments.of(
                "credentials",
                "https://recruiter:secret@application-service"
            ),
            Arguments.of(
                "path",
                "https://application-service/internal/v1"
            ),
            Arguments.of(
                "query",
                "https://application-service?debug=true"
            ),
            Arguments.of(
                "fragment",
                "https://application-service#fragment"
            ),
            Arguments.of(
                "non HTTP scheme",
                "ftp://application-service"
            ),
            Arguments.of(
                "unlisted host",
                "https://untrusted-service"
            )
        );
    }

    @Test
    void validateBaseUrlAcceptsAllowlistedOriginWithRootPath() {
        URI result = ApplicationClient.validateBaseUrl(
            "https://APPLICATION-SERVICE/",
            " application-service , application-service-backup "
        );

        assertThat(result).isEqualTo(URI.create(
            "https://APPLICATION-SERVICE/"
        ));
    }

    private void expectResponse(HttpStatus status, String responseBody) {
        server.expect(once(), requestTo(BASE_URL + AUTHORIZE_PATH))
            .andExpect(method(HttpMethod.POST))
            .andRespond(withStatus(status).body(responseBody));
    }

    private void assertUnavailable() {
        assertBusinessError(
            "APPLICATION_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private void assertBusinessError(
        String expectedCode,
        HttpStatus expectedStatus
    ) {
        assertThatThrownBy(() -> client.authorizeScheduling(
            APPLICATION_ID,
            BEARER_TOKEN
        ))
            .isInstanceOfSatisfying(BusinessException.class, exception -> {
                assertThat(exception.code()).isEqualTo(expectedCode);
                assertThat(exception.status()).isEqualTo(expectedStatus);
            });
    }

    private static String validEnvelope(UUID applicationId) {
        return """
            {
              "data": {
                "applicationId": "%s",
                "jobId": "%s",
                "companyId": "%s",
                "candidateId": "%s",
                "status": "REVIEWING",
                "applicationVersion": 7
              },
              "meta": null
            }
            """.formatted(
                applicationId,
                JOB_ID,
                COMPANY_ID,
                CANDIDATE_ID
            );
    }

    private static String validEnvelopeWithUnknownEnvelopeField() {
        return """
            {
              "data": {
                "applicationId": "%s",
                "jobId": "%s",
                "companyId": "%s",
                "candidateId": "%s",
                "status": "REVIEWING",
                "applicationVersion": 7
              },
              "meta": null,
              "unexpected": true
            }
            """.formatted(
                APPLICATION_ID,
                JOB_ID,
                COMPANY_ID,
                CANDIDATE_ID
            );
    }

    private static String validEnvelopeWithUnknownContextField() {
        return """
            {
              "data": {
                "applicationId": "%s",
                "jobId": "%s",
                "companyId": "%s",
                "candidateId": "%s",
                "status": "REVIEWING",
                "applicationVersion": 7,
                "unexpected": true
              },
              "meta": null
            }
            """.formatted(
                APPLICATION_ID,
                JOB_ID,
                COMPANY_ID,
                CANDIDATE_ID
            );
    }
}
