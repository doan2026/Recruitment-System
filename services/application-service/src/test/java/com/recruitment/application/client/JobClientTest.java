package com.recruitment.application.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient.ActiveJobStats;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class JobClientTest {
    private static final String BASE_URL = "http://job-search-service:3000";
    private static final String INTERNAL_API_KEY = "shared-internal-key";
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000002"
    );

    private MockRestServiceServer server;
    private JobClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        client = new JobClient(builder, BASE_URL, INTERNAL_API_KEY);
    }

    @Test
    void loadsActiveJobStatsFromTheInternalEndpoint() {
        expectSuccess("""
            {
              "data": {
                "companyId": "%s",
                "activeJobCount": 3,
                "ignoredFutureField": true
              },
              "meta": null
            }
            """.formatted(COMPANY_ID));

        ActiveJobStats result = client.getActiveJobStats(COMPANY_ID);

        assertThat(result.companyId()).isEqualTo(COMPANY_ID);
        assertThat(result.activeJobCount()).isEqualTo(3L);
        server.verify();
    }

    @Test
    void missingResponseDataFailsClosed() {
        expectSuccess("""
            {"data": null, "meta": null}
            """);

        assertInvalidResponse(() -> client.getActiveJobStats(COMPANY_ID));
        server.verify();
    }

    @Test
    void incompleteResponseFailsClosed() {
        expectSuccess("""
            {
              "data": {"companyId": "%s"},
              "meta": null
            }
            """.formatted(COMPANY_ID));

        assertInvalidResponse(() -> client.getActiveJobStats(COMPANY_ID));
        server.verify();
    }

    @Test
    void companyMismatchFailsClosed() {
        expectSuccess("""
            {
              "data": {
                "companyId": "%s",
                "activeJobCount": 3
              },
              "meta": null
            }
            """.formatted(OTHER_COMPANY_ID));

        assertInvalidResponse(() -> client.getActiveJobStats(COMPANY_ID));
        server.verify();
    }

    @Test
    void negativeCountFailsClosed() {
        expectSuccess("""
            {
              "data": {
                "companyId": "%s",
                "activeJobCount": -1
              },
              "meta": null
            }
            """.formatted(COMPANY_ID));

        assertInvalidResponse(() -> client.getActiveJobStats(COMPANY_ID));
        server.verify();
    }

    @Test
    void downstreamFailureMapsToUnavailable() {
        expectRequest().andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));

        assertUnavailable(() -> client.getActiveJobStats(COMPANY_ID));
        server.verify();
    }

    @Test
    void clientErrorMapsToInvalidResponse() {
        expectRequest().andRespond(withStatus(HttpStatus.UNAUTHORIZED));

        assertInvalidResponse(() -> client.getActiveJobStats(COMPANY_ID));
        server.verify();
    }

    @Test
    void rateLimitMapsToUnavailable() {
        expectRequest().andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));

        assertUnavailable(() -> client.getActiveJobStats(COMPANY_ID));
        server.verify();
    }

    private void expectSuccess(String body) {
        expectRequest().andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
    }

    private org.springframework.test.web.client.ResponseActions expectRequest() {
        return server.expect(requestTo(
            BASE_URL + "/stats/active?company_id=" + COMPANY_ID
        ))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header("X-Internal-Api-Key", INTERNAL_API_KEY));
    }

    private void assertUnavailable(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code())
                    .isEqualTo("JOB_SERVICE_UNAVAILABLE");
                assertThat(businessError.status())
                    .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                assertThat(businessError.getMessage())
                    .isEqualTo("Cannot load active job statistics");
            });
    }

    private void assertInvalidResponse(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code())
                    .isEqualTo("JOB_SERVICE_INVALID_RESPONSE");
                assertThat(businessError.status())
                    .isEqualTo(HttpStatus.BAD_GATEWAY);
                assertThat(businessError.getMessage())
                    .isEqualTo(
                        "Job Service returned an invalid active job statistics response"
                    );
            });
    }
}
