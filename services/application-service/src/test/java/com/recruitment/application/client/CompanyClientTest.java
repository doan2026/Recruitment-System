package com.recruitment.application.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.recruitment.application.api.BusinessException;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class CompanyClientTest {
    private static final String BASE_URL = "http://company-service:3000";
    private static final String AUTHORIZATION = "Bearer recruiter-token";
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );

    private MockRestServiceServer server;
    private CompanyClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        client = new CompanyClient(builder, BASE_URL);
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void resolvesSupportedMembershipAndForwardsAuthorization(
        CompanyMemberRole role
    ) {
        expectMembershipResponse(
            """
            {
              "data": {
                "companyId": "%s",
                "name": "Recruitment Company",
                "verifiedStatus": "VERIFIED",
                "memberRole": "%s"
              },
              "meta": null
            }
            """.formatted(COMPANY_ID, role)
        );

        RecruiterCompanyMembership membership =
            client.getRecruiterMembership(RECRUITER_ID, AUTHORIZATION);

        assertThat(membership.companyId()).isEqualTo(COMPANY_ID);
        assertThat(membership.memberRole()).isEqualTo(role);
        assertThat(membership.canManageAllCompanyApplications()).isTrue();
        server.verify();
    }

    @ParameterizedTest
    @EnumSource(
        value = HttpStatus.class,
        names = {"NOT_FOUND", "FORBIDDEN"}
    )
    void missingMembershipMapsToAccessDenied(HttpStatus downstreamStatus) {
        expectStatus(downstreamStatus);

        assertBusinessError(
            () -> client.getRecruiterMembership(
                RECRUITER_ID,
                AUTHORIZATION
            ),
            "APPLICATION_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );
        server.verify();
    }

    @Test
    void missingCompanyIdFailsClosedWhenContractIsIncomplete() {
        expectMembershipResponse(
            """
            {
              "data": {
                "memberRole": "MEMBER",
                "verifiedStatus": "VERIFIED"
              },
              "meta": null
            }
            """
        );

        assertBusinessError(
            () -> client.getRecruiterMembership(
                RECRUITER_ID,
                AUTHORIZATION
            ),
            "COMPANY_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
        server.verify();
    }

    @Test
    void missingRoleFailsClosedWhenContractIsIncomplete() {
        expectMembershipResponse(
            """
            {
              "data": {
                "companyId": "%s",
                "verifiedStatus": "VERIFIED"
              },
              "meta": null
            }
            """.formatted(COMPANY_ID)
        );

        assertBusinessError(
            () -> client.getRecruiterMembership(
                RECRUITER_ID,
                AUTHORIZATION
            ),
            "COMPANY_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
        server.verify();
    }

    @Test
    void unsupportedRoleFailsClosed() {
        expectMembershipResponse(
            """
            {
              "data": {
                "companyId": "%s",
                "memberRole": "VIEWER"
              },
              "meta": null
            }
            """.formatted(COMPANY_ID)
        );

        assertBusinessError(
            () -> client.getRecruiterMembership(
                RECRUITER_ID,
                AUTHORIZATION
            ),
            "COMPANY_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
        server.verify();
    }

    @Test
    void companyServiceFailureMapsToUnavailable() {
        expectStatus(HttpStatus.INTERNAL_SERVER_ERROR);

        assertBusinessError(
            () -> client.getRecruiterMembership(
                RECRUITER_ID,
                AUTHORIZATION
            ),
            "COMPANY_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
        server.verify();
    }

    @ParameterizedTest
    @EnumSource(
        value = HttpStatus.class,
        names = {"UNAUTHORIZED", "TOO_MANY_REQUESTS"}
    )
    void unexpectedClientErrorsMapToUnavailable(HttpStatus downstreamStatus) {
        expectStatus(downstreamStatus);

        assertBusinessError(
            () -> client.getRecruiterMembership(
                RECRUITER_ID,
                AUTHORIZATION
            ),
            "COMPANY_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );
        server.verify();
    }

    private void expectMembershipResponse(String body) {
        server.expect(requestTo(
            BASE_URL + "/by-user/" + RECRUITER_ID
        ))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header(HttpHeaders.AUTHORIZATION, AUTHORIZATION))
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
    }

    private void expectStatus(HttpStatus status) {
        server.expect(requestTo(
            BASE_URL + "/by-user/" + RECRUITER_ID
        ))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header(HttpHeaders.AUTHORIZATION, AUTHORIZATION))
            .andRespond(withStatus(status));
    }

    private void assertBusinessError(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
        String code,
        HttpStatus status
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code()).isEqualTo(code);
                assertThat(businessError.status()).isEqualTo(status);
            });
    }
}
