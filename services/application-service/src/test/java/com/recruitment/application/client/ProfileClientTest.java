package com.recruitment.application.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.recruitment.application.api.BusinessException;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ProfileClientTest {
    private static final String BASE_URL = "http://profile-service:3000";
    private static final String INTERNAL_KEY =
        "application-to-profile-test-key-0000000000000001";
    private static final String AUTHORIZATION = "Bearer candidate-token";
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000001"
    );
    private static final UUID CV_ID = UUID.fromString(
        "20000000-0000-4000-8000-000000000001"
    );
    private static final UUID FILE_ID = UUID.fromString(
        "30000000-0000-4000-8000-000000000001"
    );

    private MockRestServiceServer server;
    private ProfileClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        client = new ProfileClient(builder, BASE_URL, INTERNAL_KEY);
    }

    @Test
    void verifiesCandidateCvWithServiceCredentialAndCandidateBearer() {
        expectVerify().andRespond(withSuccess(
            """
            {
              "data": {
                "candidateId": "%s",
                "cvId": "%s",
                "available": true,
                "cv": %s
              },
              "meta": null
            }
            """.formatted(CANDIDATE_ID, CV_ID, cvJson(false)),
            MediaType.APPLICATION_JSON
        ));

        assertThat(client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        )).isTrue();
        server.verify();
    }

    @Test
    void unavailableCandidateCvReturnsFalseWithoutFailingSubmissionClient() {
        expectVerify().andRespond(withSuccess(
            """
            {
              "data": {
                "candidateId": "%s",
                "cvId": "%s",
                "available": false,
                "cv": null
              },
              "meta": null
            }
            """.formatted(CANDIDATE_ID, CV_ID),
            MediaType.APPLICATION_JSON
        ));

        assertThat(client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        )).isFalse();
        server.verify();
    }

    @Test
    void verifyRejectsMismatchedEchoAndIncoherentAvailability() {
        UUID otherCv = UUID.randomUUID();
        expectVerify().andRespond(withSuccess(
            """
            {
              "data": {
                "candidateId": "%s",
                "cvId": "%s",
                "available": true,
                "cv": %s
              },
              "meta": null
            }
            """.formatted(CANDIDATE_ID, otherCv, cvJson(false)),
            MediaType.APPLICATION_JSON
        ));
        assertInvalid(() -> client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        ));
        server.verify();
        server.reset();

        expectVerify().andRespond(withSuccess(
            """
            {
              "data": {
                "candidateId": "%s",
                "cvId": "%s",
                "available": false,
                "cv": %s
              },
              "meta": null
            }
            """.formatted(CANDIDATE_ID, CV_ID, cvJson(false)),
            MediaType.APPLICATION_JSON
        ));
        assertInvalid(() -> client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        ));
        server.verify();
    }

    @Test
    void verifyRejectsDeletedCvAndUnknownResponseFields() {
        expectVerify().andRespond(withSuccess(
            """
            {
              "data": {
                "candidateId": "%s",
                "cvId": "%s",
                "available": true,
                "cv": %s
              },
              "meta": null
            }
            """.formatted(CANDIDATE_ID, CV_ID, cvJson(true)),
            MediaType.APPLICATION_JSON
        ));
        assertInvalid(() -> client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        ));
        server.verify();
        server.reset();

        expectVerify().andRespond(withSuccess(
            """
            {
              "data": {
                "candidateId": "%s",
                "cvId": "%s",
                "available": false,
                "cv": null,
                "unexpected": true
              },
              "meta": null
            }
            """.formatted(CANDIDATE_ID, CV_ID),
            MediaType.APPLICATION_JSON
        ));
        assertInvalid(() -> client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        ));
        server.verify();
    }

    @Test
    void nonV4CvIsUnavailableWithoutCallingProfile() {
        UUID v1Cv = UUID.fromString(
            "20000000-0000-1000-8000-000000000001"
        );

        assertThat(client.candidateOwnsCv(
            CANDIDATE_ID,
            v1Cv,
            AUTHORIZATION
        )).isFalse();
        server.verify();
    }

    @Test
    void nonV4CandidateFailsAsInvalidSubjectWithoutCallingProfile() {
        UUID v1Candidate = UUID.fromString(
            "10000000-0000-1000-8000-000000000001"
        );

        assertThatThrownBy(() -> client.candidateOwnsCv(
            v1Candidate,
            CV_ID,
            AUTHORIZATION
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException business = (BusinessException) error;
                assertThat(business.code()).isEqualTo("INVALID_TOKEN_SUBJECT");
                assertThat(business.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
            });
        server.verify();
    }

    @Test
    void verifyMapsContractHttpFailureToInvalidResponse() {
        expectVerify().andRespond(withStatus(HttpStatus.BAD_REQUEST));

        assertInvalid(() -> client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        ));
        server.verify();
    }

    @Test
    void verifyMapsProfileHttpFailureToUnavailable() {
        expectVerify().andRespond(withStatus(HttpStatus.UNAUTHORIZED));

        assertThatThrownBy(() -> client.candidateOwnsCv(
            CANDIDATE_ID,
            CV_ID,
            AUTHORIZATION
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException business = (BusinessException) error;
                assertThat(business.code())
                    .isEqualTo("PROFILE_SERVICE_UNAVAILABLE");
                assertThat(business.status())
                    .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            });
        server.verify();
    }

    @Test
    void loadsSoftDeletedCvRevisionUsingOnlyInternalHeaders() {
        server.expect(requestTo(
            BASE_URL + "/internal/v1/candidates/" + CANDIDATE_ID +
                "/cvs/" + CV_ID
        ))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header("X-Internal-Service", "application-service"))
            .andExpect(header("X-Internal-Api-Key", INTERNAL_KEY))
            .andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
            .andRespond(withSuccess(
                "{\"data\":" + cvJson(true) + ",\"meta\":null}",
                MediaType.APPLICATION_JSON
            ));

        ProfileClient.ProfileCv cv = client.getCandidateCv(
            CANDIDATE_ID,
            CV_ID
        );

        assertThat(cv.cvId()).isEqualTo(CV_ID);
        assertThat(cv.isDeleted()).isTrue();
        server.verify();
    }

    @Test
    void detailRejectsMalformedCvInvariants() {
        UUID v1File = UUID.fromString(
            "30000000-0000-1000-8000-000000000001"
        );
        String[] malformedCvs = {
            cvJson(false).replace(
                "\"title\": \"Backend CV\"",
                "\"title\": \" Backend CV \""
            ),
            cvJson(false).replace(FILE_ID.toString(), v1File.toString()),
            cvJson(true).replace(
                "\"isDefault\": false",
                "\"isDefault\": true"
            )
        };

        for (String malformedCv : malformedCvs) {
            server.expect(requestTo(
                BASE_URL + "/internal/v1/candidates/" + CANDIDATE_ID +
                    "/cvs/" + CV_ID
            )).andRespond(withSuccess(
                "{\"data\":" + malformedCv + ",\"meta\":null}",
                MediaType.APPLICATION_JSON
            ));

            assertInvalid(() -> client.getCandidateCv(CANDIDATE_ID, CV_ID));
            server.verify();
            server.reset();
        }
    }

    @Test
    void recruiterCvCallsClassifyProfileClientErrorsConsistently() {
        String detailUrl =
            BASE_URL + "/internal/v1/candidates/" + CANDIDATE_ID +
                "/cvs/" + CV_ID;
        server.expect(requestTo(detailUrl))
            .andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        assertUnavailable(() -> client.getCandidateCv(CANDIDATE_ID, CV_ID));
        server.verify();
        server.reset();

        String downloadUrl = detailUrl + "/download-url";
        server.expect(requestTo(downloadUrl))
            .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        assertUnavailable(() ->
            client.createCandidateCvDownloadUrl(CANDIDATE_ID, CV_ID)
        );
        server.verify();
        server.reset();

        server.expect(requestTo(downloadUrl))
            .andRespond(withStatus(HttpStatus.NOT_FOUND));
        assertInvalid(() ->
            client.createCandidateCvDownloadUrl(CANDIDATE_ID, CV_ID)
        );
        server.verify();
    }

    @Test
    void createsStrictPrivateCvDownloadUrl() {
        Instant expiresAt = Instant.now().plusSeconds(300);
        server.expect(requestTo(
            BASE_URL + "/internal/v1/candidates/" + CANDIDATE_ID +
                "/cvs/" + CV_ID + "/download-url"
        ))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("X-Internal-Service", "application-service"))
            .andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
            .andExpect(header("X-Internal-Api-Key", INTERNAL_KEY))
            .andRespond(withSuccess(
                """
                {
                  "data": {
                    "candidateId": "%s",
                    "cvId": "%s",
                    "url": "https://media.example/cv.pdf?token=short",
                    "expiresAt": "%s"
                  },
                  "meta": null
                }
                """.formatted(CANDIDATE_ID, CV_ID, expiresAt),
                MediaType.APPLICATION_JSON
            ));

        ProfileClient.CvDownloadUrl result =
            client.createCandidateCvDownloadUrl(CANDIDATE_ID, CV_ID);

        assertThat(result.url()).startsWith("https://");
        assertThat(result.expiresAt()).isEqualTo(expiresAt);
        server.verify();
    }

    @Test
    void downloadRejectsNonHttpsUrl() {
        Instant expiresAt = Instant.now().plusSeconds(300);
        server.expect(requestTo(
            BASE_URL + "/internal/v1/candidates/" + CANDIDATE_ID +
                "/cvs/" + CV_ID + "/download-url"
        ))
            .andRespond(withSuccess(
                """
                {
                  "data": {
                    "candidateId": "%s",
                    "cvId": "%s",
                    "url": "http://media.example/cv.pdf",
                    "expiresAt": "%s"
                  },
                  "meta": null
                }
                """.formatted(CANDIDATE_ID, CV_ID, expiresAt),
                MediaType.APPLICATION_JSON
            ));

        assertInvalid(() -> client.createCandidateCvDownloadUrl(
            CANDIDATE_ID,
            CV_ID
        ));
        server.verify();
    }

    @Test
    void downloadRejectsFarFutureExpiryAndUrlFragment() {
        server.expect(requestTo(
            BASE_URL + "/internal/v1/candidates/" + CANDIDATE_ID +
                "/cvs/" + CV_ID + "/download-url"
        ))
            .andRespond(withSuccess(
                """
                {
                  "data": {
                    "candidateId": "%s",
                    "cvId": "%s",
                    "url": "https://media.example/cv.pdf#secret",
                    "expiresAt": "%s"
                  },
                  "meta": null
                }
                """.formatted(
                    CANDIDATE_ID,
                    CV_ID,
                    Instant.now().plusSeconds(3600)
                ),
                MediaType.APPLICATION_JSON
            ));

        assertInvalid(() -> client.createCandidateCvDownloadUrl(
            CANDIDATE_ID,
            CV_ID
        ));
        server.verify();
    }

    @Test
    void outboundInternalKeyConfigurationFailsFast() {
        assertThatThrownBy(() -> new ProfileClient(
            RestClient.builder(),
            BASE_URL,
            "replace-with-a-profile-key-that-is-long-enough"
        )).isInstanceOf(IllegalStateException.class);

        assertThatThrownBy(() -> new ProfileClient(
            RestClient.builder(),
            BASE_URL,
            INTERNAL_KEY + "\t"
        )).isInstanceOf(IllegalStateException.class);
    }

    private org.springframework.test.web.client.ResponseActions expectVerify() {
        return server.expect(requestTo(BASE_URL + "/internal/v1/cvs/verify"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("X-Internal-Service", "application-service"))
            .andExpect(header("X-Internal-Api-Key", INTERNAL_KEY))
            .andExpect(header(HttpHeaders.AUTHORIZATION, AUTHORIZATION))
            .andExpect(content().json(
                "{\"candidateId\":\"" + CANDIDATE_ID +
                    "\",\"cvId\":\"" + CV_ID + "\"}"
            ));
    }

    private String cvJson(boolean deleted) {
        return """
            {
              "cvId": "%s",
              "candidateId": "%s",
              "title": "Backend CV",
              "type": "UPLOAD",
              "fileId": "%s",
              "isDefault": %s,
              "isDeleted": %s,
              "firstUsedAt": null,
              "aggregateVersion": 1,
              "createdAt": "2026-08-27T08:00:00Z",
              "updatedAt": "2026-08-27T08:00:00Z"
            }
            """.formatted(CV_ID, CANDIDATE_ID, FILE_ID, !deleted, deleted);
    }

    private void assertUnavailable(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException business = (BusinessException) error;
                assertThat(business.code())
                    .isEqualTo("PROFILE_SERVICE_UNAVAILABLE");
                assertThat(business.status())
                    .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            });
    }

    private void assertInvalid(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException business = (BusinessException) error;
                assertThat(business.code())
                    .isEqualTo("PROFILE_SERVICE_INVALID_RESPONSE");
                assertThat(business.status()).isEqualTo(HttpStatus.BAD_GATEWAY);
            });
    }
}
