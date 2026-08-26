package com.recruitment.application.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient.ActiveJobStats;
import com.recruitment.application.client.JobClient.BulkJobDetails;
import java.util.List;
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
    private static final UUID JOB_ID = UUID.fromString(
        "20000000-0000-4000-8000-000000000001"
    );
    private static final UUID OTHER_JOB_ID = UUID.fromString(
        "20000000-0000-4000-8000-000000000002"
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

    @Test
    void emptyBulkRequestDoesNotCallJobService() {
        BulkJobDetails result = client.getBulkDetails(List.of());

        assertThat(result.items()).isEmpty();
        assertThat(result.unavailableJobIds()).isEmpty();
        server.verify();
    }

    @Test
    void loadsBulkDetailsAndUnavailableIds() {
        expectBulkRequest(List.of(JOB_ID, OTHER_JOB_ID)).andRespond(
            withSuccess(
                """
                {
                  "data": {
                    "items": [%s],
                    "unavailableJobIds": ["%s"]
                  },
                  "meta": null
                }
                """.formatted(jobDetailJson(JOB_ID), OTHER_JOB_ID),
                MediaType.APPLICATION_JSON
            )
        );

        BulkJobDetails result = client.getBulkDetails(
            List.of(JOB_ID, OTHER_JOB_ID)
        );

        assertThat(result.items()).singleElement().satisfies(job -> {
            assertThat(job.id()).isEqualTo(JOB_ID);
            assertThat(job.title()).isEqualTo("Backend Engineer");
            assertThat(job.salaryMin()).isEqualTo("20000000.00");
            assertThat(job.acceptingApplications()).isTrue();
        });
        assertThat(result.unavailableJobIds())
            .containsExactly(OTHER_JOB_ID);
        server.verify();
    }

    @Test
    void splitsBulkDetailsIntoChunksOfOneHundred() {
        List<UUID> jobIds = java.util.stream.IntStream.range(0, 101)
            .mapToObj(index -> UUID.fromString(
                "30000000-0000-4000-8000-%012d".formatted(index)
            ))
            .toList();
        List<UUID> firstChunk = jobIds.subList(0, 100);
        List<UUID> secondChunk = jobIds.subList(100, 101);
        expectUnavailableBulkResponse(firstChunk);
        expectUnavailableBulkResponse(secondChunk);

        BulkJobDetails result = client.getBulkDetails(jobIds);

        assertThat(result.items()).isEmpty();
        assertThat(result.unavailableJobIds()).containsExactlyElementsOf(jobIds);
        server.verify();
    }

    @Test
    void rejectsBulkResponseThatDoesNotCoverEveryRequestedId() {
        expectBulkRequest(List.of(JOB_ID, OTHER_JOB_ID)).andRespond(
            withSuccess(
                bulkResponse(jobDetailJson(JOB_ID), ""),
                MediaType.APPLICATION_JSON
            )
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID, OTHER_JOB_ID))
        );
        server.verify();
    }

    @Test
    void rejectsBulkResponseWithAnExtraId() {
        expectBulkRequest(List.of(JOB_ID)).andRespond(
            withSuccess(
                bulkResponse(
                    jobDetailJson(JOB_ID),
                    "\"" + OTHER_JOB_ID + "\""
                ),
                MediaType.APPLICATION_JSON
            )
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID))
        );
        server.verify();
    }

    @Test
    void rejectsDuplicateIdsInBulkResponse() {
        expectBulkRequest(List.of(JOB_ID)).andRespond(
            withSuccess(
                bulkResponse(
                    jobDetailJson(JOB_ID) + "," + jobDetailJson(JOB_ID),
                    ""
                ),
                MediaType.APPLICATION_JSON
            )
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID))
        );
        server.verify();
    }

    @Test
    void rejectsOverlapsSemanticViolationsAndWrongItemOrder() {
        expectBulkRequest(List.of(JOB_ID)).andRespond(
            withSuccess(
                bulkResponse(
                    jobDetailJson(JOB_ID),
                    "\"" + JOB_ID + "\""
                ),
                MediaType.APPLICATION_JSON
            )
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID))
        );
        server.verify();
        server.reset();

        String invalidSalary = jobDetailJson(JOB_ID).replace(
            "\"isNegotiable\": false",
            "\"isNegotiable\": true"
        );
        expectBulkRequest(List.of(JOB_ID)).andRespond(
            withSuccess(
                bulkResponse(invalidSalary, ""),
                MediaType.APPLICATION_JSON
            )
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID))
        );
        server.verify();
        server.reset();

        String invalidAvailability = jobDetailJson(JOB_ID)
            .replace(
                "\"acceptingApplications\": true",
                "\"acceptingApplications\": false"
            )
            .replace(
                "\"availabilityReason\": null",
                "\"availabilityReason\": \"NOT_PUBLISHED\""
            );
        expectBulkRequest(List.of(JOB_ID)).andRespond(
            withSuccess(
                bulkResponse(invalidAvailability, ""),
                MediaType.APPLICATION_JSON
            )
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID))
        );
        server.verify();
        server.reset();

        expectBulkRequest(List.of(JOB_ID, OTHER_JOB_ID)).andRespond(
            withSuccess(
                bulkResponse(
                    jobDetailJson(OTHER_JOB_ID) + "," + jobDetailJson(JOB_ID),
                    ""
                ),
                MediaType.APPLICATION_JSON
            )
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID, OTHER_JOB_ID))
        );
        server.verify();
    }

    @Test
    void bulkServerFailureMapsToUnavailable() {
        expectBulkRequest(List.of(JOB_ID)).andRespond(
            withStatus(HttpStatus.INTERNAL_SERVER_ERROR)
        );

        assertBulkUnavailable(() -> client.getBulkDetails(List.of(JOB_ID)));
        server.verify();
    }

    @Test
    void bulkClientErrorMapsToInvalidResponse() {
        expectBulkRequest(List.of(JOB_ID)).andRespond(
            withStatus(HttpStatus.UNAUTHORIZED)
        );

        assertBulkInvalidResponse(
            () -> client.getBulkDetails(List.of(JOB_ID))
        );
        server.verify();
    }

    private void expectUnavailableBulkResponse(List<UUID> jobIds) {
        expectBulkRequest(jobIds).andRespond(
            withSuccess(
                bulkResponse("", jobIdsJson(jobIds)),
                MediaType.APPLICATION_JSON
            )
        );
    }

    private org.springframework.test.web.client.ResponseActions expectBulkRequest(
        List<UUID> jobIds
    ) {
        return server.expect(requestTo(BASE_URL + "/details/bulk"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("X-Internal-Api-Key", INTERNAL_API_KEY))
            .andExpect(content().json(
                "{\"jobIds\":[" + jobIdsJson(jobIds) + "]}"
            ));
    }

    private String bulkResponse(String items, String unavailableJobIds) {
        return """
            {
              "data": {
                "items": [%s],
                "unavailableJobIds": [%s]
              },
              "meta": null
            }
            """.formatted(items, unavailableJobIds);
    }

    private String jobIdsJson(List<UUID> jobIds) {
        return jobIds.stream()
            .map(jobId -> "\"" + jobId + "\"")
            .collect(java.util.stream.Collectors.joining(","));
    }

    private String jobDetailJson(UUID jobId) {
        return """
            {
              "id": "%s",
              "companyId": "%s",
              "title": "Backend Engineer",
              "description": "Build recruitment services",
              "requirements": "Java and PostgreSQL",
              "benefits": "Remote-friendly",
              "salaryMin": "20000000.00",
              "salaryMax": "30000000.00",
              "isNegotiable": false,
              "currency": "VND",
              "location": "Ha Noi",
              "jobType": "FULL_TIME",
              "experienceYears": 2,
              "quantity": 3,
              "skills": ["Java", "Spring"],
              "deadline": "2099-12-31",
              "status": "PUBLISHED",
              "publishedAt": "2026-08-24T08:00:00.000Z",
              "createdAt": "2026-08-23T08:00:00.000Z",
              "updatedAt": "2026-08-24T08:00:00.000Z",
              "acceptingApplications": true,
              "availabilityReason": null,
              "ignoredFutureField": true
            }
            """.formatted(jobId, COMPANY_ID);
    }

    private void assertBulkUnavailable(
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
                    .isEqualTo("Cannot load bookmarked job details");
            });
    }

    private void assertBulkInvalidResponse(
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
                        "Job Service returned an invalid bulk job details response"
                    );
            });
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
