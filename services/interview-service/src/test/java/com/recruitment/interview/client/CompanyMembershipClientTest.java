package com.recruitment.interview.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.interview.api.BusinessException;
import java.io.IOException;
import java.net.URI;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class CompanyMembershipClientTest {
    private static final String BASE_URL = "https://company-service:3000";
    private static final String RAW_TOKEN = "header.payload.signature";
    private static final UUID RECRUITER_ID = UUID.fromString(
        "223e4567-e89b-42d3-a456-426614174000"
    );
    private static final UUID COMPANY_ID = UUID.fromString(
        "323e4567-e89b-42d3-a456-426614174000"
    );

    private MockRestServiceServer server;
    private CompanyMembershipClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
        server = MockRestServiceServer.bindTo(builder).build();
        client = new CompanyMembershipClient(
            builder.build(),
            new ObjectMapper()
        );
    }

    @AfterEach
    void verifyServer() {
        server.verify();
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void resolvesCurrentMembershipWithExactGetAndRawBearerContract(
        CompanyMemberRole role
    ) {
        expectSuccess(validEnvelope(role));

        RecruiterCompanyMembership membership = client.resolve(
            RECRUITER_ID,
            RAW_TOKEN
        );

        assertThat(membership).isEqualTo(new RecruiterCompanyMembership(
            COMPANY_ID,
            role
        ));
    }

    @ParameterizedTest
    @EnumSource(
        value = HttpStatus.class,
        names = {"FORBIDDEN", "NOT_FOUND"}
    )
    void mapsForbiddenAndMissingMembershipToInterviewAccessDenied(
        HttpStatus upstreamStatus
    ) {
        expectStatus(upstreamStatus);

        assertBusinessError(
            "INTERVIEW_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("unavailableStatuses")
    void mapsEveryOtherStatusToCompanyUnavailable(
        String description,
        HttpStatus upstreamStatus
    ) {
        expectStatus(upstreamStatus);

        assertUnavailable();
    }

    private static Stream<Arguments> unavailableStatuses() {
        return Stream.of(
            Arguments.of("unexpected success", HttpStatus.CREATED),
            Arguments.of("redirect", HttpStatus.FOUND),
            Arguments.of("unauthorized", HttpStatus.UNAUTHORIZED),
            Arguments.of("rate limited", HttpStatus.TOO_MANY_REQUESTS),
            Arguments.of("server failure", HttpStatus.INTERNAL_SERVER_ERROR),
            Arguments.of("gateway failure", HttpStatus.BAD_GATEWAY),
            Arguments.of("dependency unavailable", HttpStatus.SERVICE_UNAVAILABLE)
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidPayloads")
    void rejectsMalformedIncompleteNonExactOrInvalidMembershipPayloads(
        String description,
        String body
    ) {
        expectSuccess(body);

        assertUnavailable();
    }

    private static Stream<Arguments> invalidPayloads() {
        return Stream.of(
            Arguments.of("malformed JSON", "{"),
            Arguments.of("missing meta", "{\"data\":" + validData("MEMBER") + "}"),
            Arguments.of(
                "non-null meta",
                "{\"data\":" + validData("MEMBER") + ",\"meta\":{}}"
            ),
            Arguments.of(
                "unknown envelope field",
                "{\"data\":" + validData("MEMBER")
                    + ",\"meta\":null,\"unexpected\":true}"
            ),
            Arguments.of(
                "unknown membership field",
                "{\"data\":" + validData("MEMBER").replace(
                    "}",
                    ",\"unexpected\":true}"
                ) + ",\"meta\":null}"
            ),
            Arguments.of(
                "duplicate company id",
                "{\"data\":" + validData("MEMBER").replace(
                    "\"name\"",
                    "\"companyId\":\"" + COMPANY_ID + "\",\"name\""
                ) + ",\"meta\":null}"
            ),
            Arguments.of(
                "missing company id",
                validEnvelope("MEMBER").replace(
                    "\"companyId\":\"" + COMPANY_ID + "\",",
                    ""
                )
            ),
            Arguments.of(
                "null company id",
                validEnvelope("MEMBER").replace(
                    "\"companyId\":\"" + COMPANY_ID + "\"",
                    "\"companyId\":null"
                )
            ),
            Arguments.of(
                "non-v4 company id",
                validEnvelope("MEMBER").replace(
                    COMPANY_ID.toString(),
                    "323e4567-e89b-12d3-a456-426614174000"
                )
            ),
            Arguments.of(
                "uppercase non-canonical company id",
                validEnvelope("MEMBER").replace(
                    COMPANY_ID.toString(),
                    COMPANY_ID.toString().toUpperCase()
                )
            ),
            Arguments.of(
                "unsupported role",
                validEnvelope("VIEWER")
            ),
            Arguments.of(
                "unsupported verification status",
                validEnvelope("MEMBER").replace("VERIFIED", "SUSPENDED")
            ),
            Arguments.of(
                "blank company name",
                validEnvelope("MEMBER").replace("Recruitment Company", " ")
            ),
            Arguments.of(
                "scalar coercion",
                validEnvelope("MEMBER").replace(
                    "\"name\":\"Recruitment Company\"",
                    "\"name\":123"
                )
            ),
            Arguments.of(
                "trailing JSON",
                validEnvelope("MEMBER") + " true"
            )
        );
    }

    @Test
    void rejectsWrongContentType() {
        server.expect(once(), requestTo(path()))
            .andRespond(withSuccess(
                validEnvelope("MEMBER"),
                MediaType.TEXT_PLAIN
            ));
        assertUnavailable();
    }

    @Test
    void rejectsOversizedBodyBeforeJsonParsing() {
        server.expect(once(), requestTo(path()))
            .andRespond(withSuccess(
                " ".repeat(CompanyMembershipClient.MAX_RESPONSE_BYTES + 1),
                MediaType.APPLICATION_JSON
            ));
        assertUnavailable();
    }

    @Test
    void mapsNetworkFailureToCompanyUnavailable() {
        server.expect(once(), requestTo(path()))
            .andRespond(request -> {
                throw new IOException("connection reset");
            });

        assertUnavailable();
    }

    @ParameterizedTest
    @MethodSource("invalidRawTokens")
    void rejectsInvalidRawBearerTokenBeforeMakingARequest(
        String description,
        String token
    ) {
        assertThatThrownBy(() -> client.resolve(RECRUITER_ID, token))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("bearerToken must be a raw JWT");
    }

    private static Stream<Arguments> invalidRawTokens() {
        return Stream.of(
            Arguments.of("null", null),
            Arguments.of("empty", ""),
            Arguments.of("already prefixed", "Bearer " + RAW_TOKEN),
            Arguments.of("leading whitespace", " " + RAW_TOKEN),
            Arguments.of("embedded whitespace", "header. payload.signature"),
            Arguments.of("control character", "header.\npayload.signature"),
            Arguments.of("oversized", "a".repeat(8193))
        );
    }

    @Test
    void rejectsNullRecruiterBeforeMakingARequest() {
        assertThatThrownBy(() -> client.resolve(null, RAW_TOKEN))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("recruiterId is required");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("disallowedBaseUrls")
    void rejectsNonOriginOrUntrustedCompanyBaseUrls(
        String description,
        String baseUrl
    ) {
        assertThatThrownBy(() -> CompanyMembershipClient.validateBaseUrl(
            baseUrl,
            "company-service,company-service-backup"
        ))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage(
                "COMPANY_SERVICE_URL must be an allowlisted HTTP(S) origin"
            );
    }

    private static Stream<Arguments> disallowedBaseUrls() {
        return Stream.of(
            Arguments.of("credentials", "https://user:secret@company-service"),
            Arguments.of("path", "https://company-service/internal"),
            Arguments.of("query", "https://company-service?debug=true"),
            Arguments.of("fragment", "https://company-service#fragment"),
            Arguments.of("non-http", "ftp://company-service"),
            Arguments.of("unlisted host", "https://untrusted-service"),
            Arguments.of("malformed", "http://[invalid")
        );
    }

    @Test
    void acceptsAllowlistedHttpOrHttpsOriginWithOptionalRootPath() {
        assertThat(CompanyMembershipClient.validateBaseUrl(
            "https://COMPANY-SERVICE:3000/",
            " company-service , company-service-backup "
        )).isEqualTo(URI.create("https://COMPANY-SERVICE:3000/"));
        assertThat(CompanyMembershipClient.validateBaseUrl(
            "http://company-service",
            "company-service"
        )).isEqualTo(URI.create("http://company-service"));
    }

    @ParameterizedTest
    @MethodSource("invalidTimeouts")
    void rejectsUnsafeRequestTimeout(String description, long timeoutMs) {
        assertThatThrownBy(() -> new CompanyMembershipClient(
            new ObjectMapper(),
            BASE_URL,
            "company-service",
            timeoutMs
        ))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("COMPANY_REQUEST_TIMEOUT_MS must be 100..10000");
    }

    private static Stream<Arguments> invalidTimeouts() {
        return Stream.of(
            Arguments.of("too short", 99),
            Arguments.of("too long", 10_001)
        );
    }

    private void expectSuccess(String body) {
        server.expect(once(), requestTo(path()))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE))
            .andExpect(header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + RAW_TOKEN
            ))
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
    }

    private void expectStatus(HttpStatus status) {
        server.expect(once(), requestTo(path()))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + RAW_TOKEN
            ))
            .andRespond(withStatus(status));
    }

    private void assertUnavailable() {
        assertBusinessError(
            "COMPANY_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private void assertBusinessError(String code, HttpStatus status) {
        assertThatThrownBy(() -> client.resolve(RECRUITER_ID, RAW_TOKEN))
            .isInstanceOfSatisfying(BusinessException.class, exception -> {
                assertThat(exception.code()).isEqualTo(code);
                assertThat(exception.status()).isEqualTo(status);
            });
    }

    private String path() {
        return BASE_URL + "/by-user/" + RECRUITER_ID;
    }

    private static String validEnvelope(CompanyMemberRole role) {
        return validEnvelope(role.name());
    }

    private static String validEnvelope(String role) {
        return "{\"data\":" + validData(role) + ",\"meta\":null}";
    }

    private static String validData(String role) {
        return """
            {
              "companyId":"%s",
              "name":"Recruitment Company",
              "verifiedStatus":"VERIFIED",
              "memberRole":"%s"
            }
            """.formatted(COMPANY_ID, role).strip();
    }
}
