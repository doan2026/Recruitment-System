package com.recruitment.application.offer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.domain.OfferStatus;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(
    value = ApplicationOfferController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class ApplicationOfferControllerTest {
    private static final UUID APPLICATION_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID OFFER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "40000000-0000-0000-0000-000000000001"
    );
    private static final UUID FILE_ID = UUID.fromString(
        "50000000-0000-0000-0000-000000000001"
    );
    private static final String TOKEN = "header.payload.signature";
    private static final String AUTHORIZATION = "Bearer " + TOKEN;
    private static final Instant SENT_AT =
        Instant.parse("2026-08-25T08:00:00Z");
    private static final Instant EXPIRES_AT =
        Instant.parse("2099-09-05T17:00:00Z");
    private static final String FILE_URL =
        "https://files.example.test/offers/letter.pdf";

    @Autowired
    private MockMvc mvc;

    @MockBean
    private ApplicationOfferService offers;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void recruiterSendsOfferAndReceivesCreatedResponse() throws Exception {
        when(offers.send(
            eq(APPLICATION_ID),
            eq(RECRUITER_ID),
            eq(AUTHORIZATION),
            any(CreateOfferRequest.class)
        )).thenReturn(sentResponse());

        mvc.perform(sendRequest(
            RECRUITER_ID.toString(),
            "RECRUITER",
            validCreateBody()
        ))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.data.id").value(OFFER_ID.toString()))
            .andExpect(jsonPath("$.data.applicationId")
                .value(APPLICATION_ID.toString()))
            .andExpect(jsonPath("$.data.sentBy")
                .value(RECRUITER_ID.toString()))
            .andExpect(jsonPath("$.data.status").value("SENT"))
            .andExpect(jsonPath("$.data.applicationStatus").value("OFFER"))
            .andExpect(jsonPath("$.data.applicationVersion").value(1))
            .andExpect(jsonPath("$.data.version").value(0))
            .andExpect(jsonPath("$.data.fileId").value(FILE_ID.toString()))
            .andExpect(jsonPath("$.data.fileUrl").value(FILE_URL))
            .andExpect(jsonPath("$.meta").doesNotExist());

        ArgumentCaptor<CreateOfferRequest> request =
            ArgumentCaptor.forClass(CreateOfferRequest.class);
        verify(offers).send(
            eq(APPLICATION_ID),
            eq(RECRUITER_ID),
            eq(AUTHORIZATION),
            request.capture()
        );
        assertThat(request.getValue().salary())
            .isEqualByComparingTo("25000000.00");
        assertThat(request.getValue().fileId()).isEqualTo(FILE_ID);
        assertThat(request.getValue().expectedApplicationVersion())
            .isZero();
    }

    @Test
    void candidateCannotSendOfferAndServiceIsNotCalled() throws Exception {
        mvc.perform(sendRequest(
            CANDIDATE_ID.toString(),
            "CANDIDATE",
            validCreateBody()
        ))
            .andExpect(status().isForbidden());

        verifyNoInteractions(offers);
    }

    @Test
    void candidateRespondsToOfferAndReceivesOkResponse() throws Exception {
        when(offers.respond(
            eq(OFFER_ID),
            eq(CANDIDATE_ID),
            any(RespondOfferRequest.class)
        )).thenReturn(acceptedResponse());

        mvc.perform(respondRequest(
            CANDIDATE_ID.toString(),
            "CANDIDATE",
            validRespondBody()
        ))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.id").value(OFFER_ID.toString()))
            .andExpect(jsonPath("$.data.status").value("ACCEPTED"))
            .andExpect(jsonPath("$.data.applicationStatus").value("HIRED"))
            .andExpect(jsonPath("$.data.version").value(1))
            .andExpect(jsonPath("$.data.applicationVersion").value(1))
            .andExpect(jsonPath("$.data.respondedAt")
                .value(SENT_AT.plusSeconds(3600).toString()));

        ArgumentCaptor<RespondOfferRequest> request =
            ArgumentCaptor.forClass(RespondOfferRequest.class);
        verify(offers).respond(
            eq(OFFER_ID),
            eq(CANDIDATE_ID),
            request.capture()
        );
        assertThat(request.getValue().decision())
            .isEqualTo(OfferDecision.ACCEPTED);
        assertThat(request.getValue().expectedOfferVersion()).isZero();
        assertThat(request.getValue().expectedApplicationVersion()).isZero();
    }

    @Test
    void recruiterCannotRespondAndServiceIsNotCalled() throws Exception {
        mvc.perform(respondRequest(
            RECRUITER_ID.toString(),
            "RECRUITER",
            validRespondBody()
        ))
            .andExpect(status().isForbidden());

        verifyNoInteractions(offers);
    }

    @Test
    void invalidRecruiterJwtSubjectReturnsUnauthorized() throws Exception {
        mvc.perform(sendRequest(
            "not-a-uuid",
            "RECRUITER",
            validCreateBody()
        ))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INVALID_TOKEN_SUBJECT"));

        verifyNoInteractions(offers);
    }

    @Test
    void invalidCandidateJwtSubjectReturnsUnauthorized() throws Exception {
        mvc.perform(respondRequest(
            "not-a-uuid",
            "CANDIDATE",
            validRespondBody()
        ))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INVALID_TOKEN_SUBJECT"));

        verifyNoInteractions(offers);
    }

    @Test
    void invalidCreateCoreFieldsFailBeanValidation() throws Exception {
        List<ValidationCase> cases = List.of(
            new ValidationCase(
                createBody(
                    "0",
                    "2099-09-15",
                    "Backend Engineer",
                    EXPIRES_AT.toString(),
                    "0"
                ),
                "salary"
            ),
            new ValidationCase(
                createBody(
                    "25000000.00",
                    "2000-01-01",
                    "Backend Engineer",
                    EXPIRES_AT.toString(),
                    "0"
                ),
                "startDate"
            ),
            new ValidationCase(
                createBody(
                    "25000000.00",
                    "2099-09-15",
                    "   ",
                    EXPIRES_AT.toString(),
                    "0"
                ),
                "position"
            ),
            new ValidationCase(
                createBody(
                    "25000000.00",
                    "2099-09-15",
                    "Backend Engineer",
                    "2000-01-01T00:00:00Z",
                    "0"
                ),
                "expiresAt"
            ),
            new ValidationCase(
                createBody(
                    "25000000.00",
                    "2099-09-15",
                    "Backend Engineer",
                    EXPIRES_AT.toString(),
                    "-1"
                ),
                "expectedApplicationVersion"
            )
        );

        for (ValidationCase validationCase : cases) {
            mvc.perform(sendRequest(
                RECRUITER_ID.toString(),
                "RECRUITER",
                validationCase.body()
            ))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath(
                    "$.details." + validationCase.field()
                ).exists());
        }

        verifyNoInteractions(offers);
    }

    @Test
    void incompleteFilePairFailsBeanValidation() throws Exception {
        String onlyFileId = """
            {
              "salary": 25000000.00,
              "startDate": "2099-09-15",
              "position": "Backend Engineer",
              "fileId": "%s",
              "expiresAt": "%s",
              "expectedApplicationVersion": 0
            }
            """.formatted(FILE_ID, EXPIRES_AT);
        String onlyFileUrl = """
            {
              "salary": 25000000.00,
              "startDate": "2099-09-15",
              "position": "Backend Engineer",
              "fileUrl": "%s",
              "expiresAt": "%s",
              "expectedApplicationVersion": 0
            }
            """.formatted(FILE_URL, EXPIRES_AT);

        for (String body : List.of(onlyFileId, onlyFileUrl)) {
            mvc.perform(sendRequest(
                RECRUITER_ID.toString(),
                "RECRUITER",
                body
            ))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fileReferenceComplete")
                    .exists());
        }

        verifyNoInteractions(offers);
    }

    @Test
    void invalidRespondFieldsFailBeanValidation() throws Exception {
        List<ValidationCase> cases = List.of(
            new ValidationCase(
                respondBody("null", "null", "0", "0"),
                "decision"
            ),
            new ValidationCase(
                respondBody("\"DECLINED\"", "null", "0", "0"),
                "declineReasonPresent"
            ),
            new ValidationCase(
                respondBody("\"ACCEPTED\"", "null", "-1", "0"),
                "expectedOfferVersion"
            ),
            new ValidationCase(
                respondBody("\"ACCEPTED\"", "null", "0", "-1"),
                "expectedApplicationVersion"
            )
        );

        for (ValidationCase validationCase : cases) {
            mvc.perform(respondRequest(
                CANDIDATE_ID.toString(),
                "CANDIDATE",
                validationCase.body()
            ))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath(
                    "$.details." + validationCase.field()
                ).exists());
        }

        verifyNoInteractions(offers);
    }

    @Test
    void malformedDecisionReturnsStandardValidationError() throws Exception {
        mvc.perform(respondRequest(
            CANDIDATE_ID.toString(),
            "CANDIDATE",
            respondBody("\"MAYBE\"", "null", "0", "0")
        ))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.message")
                .value("Request body or parameter has an invalid format"))
            .andExpect(jsonPath("$.details").doesNotExist());

        verifyNoInteractions(offers);
    }

    @Test
    void openApiDeclaresSecuritySuccessAndErrorResponses() throws Exception {
        Method send = ApplicationOfferController.class.getMethod(
            "send",
            JwtAuthenticationToken.class,
            String.class,
            UUID.class,
            CreateOfferRequest.class
        );
        Method respond = ApplicationOfferController.class.getMethod(
            "respond",
            JwtAuthenticationToken.class,
            UUID.class,
            RespondOfferRequest.class
        );
        SecurityRequirement security = ApplicationOfferController.class
            .getAnnotation(SecurityRequirement.class);

        assertResponseCodes(
            send.getAnnotation(ApiResponses.class),
            "201",
            "400",
            "401",
            "403",
            "404",
            "409",
            "503"
        );
        assertResponseCodes(
            respond.getAnnotation(ApiResponses.class),
            "200",
            "400",
            "401",
            "403",
            "404",
            "409"
        );
        assertThat(security).isNotNull();
        assertThat(security.name()).isEqualTo("bearerAuth");
    }

    private void assertResponseCodes(
        ApiResponses responses,
        String... expectedCodes
    ) {
        assertThat(responses).isNotNull();
        assertThat(Arrays.stream(responses.value())
            .map(response -> response.responseCode()))
            .containsExactlyInAnyOrder(expectedCodes);
    }

    private MockHttpServletRequestBuilder sendRequest(
        String subject,
        String role,
        String body
    ) {
        stubJwt(subject, role);
        return post("/{applicationId}/offer", APPLICATION_ID)
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    }

    private MockHttpServletRequestBuilder respondRequest(
        String subject,
        String role,
        String body
    ) {
        stubJwt(subject, role);
        return patch("/offers/{offerId}/respond", OFFER_ID)
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    }

    private void stubJwt(String subject, String role) {
        when(jwtDecoder.decode(TOKEN)).thenReturn(Jwt
            .withTokenValue(TOKEN)
            .header("alg", "RS256")
            .subject(subject)
            .claim("role", role)
            .issuedAt(SENT_AT.minusSeconds(60))
            .expiresAt(EXPIRES_AT)
            .build());
    }

    private String validCreateBody() {
        return """
            {
              "salary": 25000000.00,
              "startDate": "2099-09-15",
              "position": "Backend Engineer",
              "note": "Welcome aboard",
              "fileId": "%s",
              "fileUrl": "%s",
              "expiresAt": "%s",
              "expectedApplicationVersion": 0
            }
            """.formatted(FILE_ID, FILE_URL, EXPIRES_AT);
    }

    private String createBody(
        String salary,
        String startDate,
        String position,
        String expiresAt,
        String expectedApplicationVersion
    ) {
        return """
            {
              "salary": %s,
              "startDate": "%s",
              "position": "%s",
              "expiresAt": "%s",
              "expectedApplicationVersion": %s
            }
            """.formatted(
                salary,
                startDate,
                position,
                expiresAt,
                expectedApplicationVersion
            );
    }

    private String validRespondBody() {
        return respondBody("\"ACCEPTED\"", "null", "0", "0");
    }

    private String respondBody(
        String decision,
        String declineReason,
        String expectedOfferVersion,
        String expectedApplicationVersion
    ) {
        return """
            {
              "decision": %s,
              "declineReason": %s,
              "expectedOfferVersion": %s,
              "expectedApplicationVersion": %s
            }
            """.formatted(
                decision,
                declineReason,
                expectedOfferVersion,
                expectedApplicationVersion
            );
    }

    private OfferResponse sentResponse() {
        return new OfferResponse(
            OFFER_ID,
            APPLICATION_ID,
            RECRUITER_ID,
            new BigDecimal("25000000.00"),
            LocalDate.of(2099, 9, 15),
            "Backend Engineer",
            "Welcome aboard",
            FILE_ID,
            FILE_URL,
            OfferStatus.SENT,
            SENT_AT,
            EXPIRES_AT,
            null,
            null,
            0L,
            ApplicationStatus.OFFER,
            1L
        );
    }

    private OfferResponse acceptedResponse() {
        return new OfferResponse(
            OFFER_ID,
            APPLICATION_ID,
            RECRUITER_ID,
            new BigDecimal("25000000.00"),
            LocalDate.of(2099, 9, 15),
            "Backend Engineer",
            "Welcome aboard",
            FILE_ID,
            FILE_URL,
            OfferStatus.ACCEPTED,
            SENT_AT,
            EXPIRES_AT,
            SENT_AT.plusSeconds(3600),
            null,
            1L,
            ApplicationStatus.HIRED,
            1L
        );
    }

    private record ValidationCase(String body, String field) {}
}
