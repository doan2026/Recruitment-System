package com.recruitment.application.evaluation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
    value = ApplicationEvaluationController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class ApplicationEvaluationControllerTest {
    private static final UUID APPLICATION_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID EVALUATION_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID EVALUATOR_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final String AUTHORIZATION = "Bearer recruiter-token";
    private static final Instant CREATED_AT =
        Instant.parse("2026-08-25T08:00:00Z");

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ApplicationEvaluationService evaluations;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void recruiterCreatesEvaluation() throws Exception {
        when(evaluations.create(
            eq(APPLICATION_ID),
            eq(EVALUATOR_ID),
            eq(AUTHORIZATION),
            any(CreateEvaluationRequest.class)
        )).thenReturn(new EvaluationResponse(
            EVALUATION_ID,
            APPLICATION_ID,
            EVALUATOR_ID,
            new BigDecimal("85.50"),
            Map.of(
                "technical", new BigDecimal("90.00"),
                "communication", new BigDecimal("80.00")
            ),
            "Strong candidate",
            CREATED_AT
        ));

        mvc.perform(request(
            EVALUATOR_ID.toString(),
            "RECRUITER",
            """
            {
              "score": 85.50,
              "criteria": {
                "technical": 90,
                "communication": 80
              },
              "note": "Strong candidate"
            }
            """
        ))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.data.id").value(EVALUATION_ID.toString()))
            .andExpect(jsonPath("$.data.applicationId")
                .value(APPLICATION_ID.toString()))
            .andExpect(jsonPath("$.data.evaluatorId")
                .value(EVALUATOR_ID.toString()))
            .andExpect(jsonPath("$.data.score").value(85.5))
            .andExpect(jsonPath("$.data.criteria.technical").value(90.0))
            .andExpect(jsonPath("$.data.criteria.communication").value(80.0))
            .andExpect(jsonPath("$.data.note").value("Strong candidate"))
            .andExpect(jsonPath("$.data.createdAt")
                .value(CREATED_AT.toString()))
            .andExpect(jsonPath("$.meta").doesNotExist());

        ArgumentCaptor<CreateEvaluationRequest> request =
            ArgumentCaptor.forClass(CreateEvaluationRequest.class);
        verify(evaluations).create(
            eq(APPLICATION_ID),
            eq(EVALUATOR_ID),
            eq(AUTHORIZATION),
            request.capture()
        );
        assertThat(request.getValue().score())
            .isEqualByComparingTo("85.50");
        assertThat(request.getValue().criteria())
            .containsEntry("technical", new BigDecimal("90"))
            .containsEntry("communication", new BigDecimal("80"));
    }

    @Test
    void candidateCannotCreateEvaluationAndServiceIsNotCalled()
        throws Exception {
        mvc.perform(request(
            UUID.randomUUID().toString(),
            "CANDIDATE",
            validBody()
        ))
            .andExpect(status().isForbidden());

        verifyNoInteractions(evaluations);
    }

    @Test
    void invalidJwtSubjectReturnsUnauthorized() throws Exception {
        mvc.perform(request(
            "not-a-uuid",
            "RECRUITER",
            validBody()
        ))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INVALID_TOKEN_SUBJECT"));

        verifyNoInteractions(evaluations);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "-0.01", "100.01", "85.555"})
    void invalidScoreFailsBeanValidation(String score) throws Exception {
        mvc.perform(recruiterRequest("""
            {
              "score": %s,
              "criteria": {"technical": 90},
              "note": "Strong candidate"
            }
            """.formatted(score)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.details.score").exists());

        verifyNoInteractions(evaluations);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}"})
    void invalidCriteriaFailsBeanValidation(String criteria)
        throws Exception {
        mvc.perform(recruiterRequest("""
            {
              "score": 85.50,
              "criteria": %s,
              "note": "Strong candidate"
            }
            """.formatted(criteria)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.details.criteria").exists());

        verifyNoInteractions(evaluations);
    }

    @Test
    void oversizedNoteFailsBeanValidation() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
            "score", new BigDecimal("85.50"),
            "criteria", Map.of("technical", new BigDecimal("90")),
            "note", "a".repeat(2001)
        ));

        mvc.perform(recruiterRequest(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.details.note").exists());

        verifyNoInteractions(evaluations);
    }

    @Test
    void wrongCriteriaJsonTypeReturnsStandardValidationError()
        throws Exception {
        mvc.perform(recruiterRequest("""
            {
              "score": 85.50,
              "criteria": [90, 80],
              "note": "Strong candidate"
            }
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.message")
                .value("Request body or parameter has an invalid format"))
            .andExpect(jsonPath("$.details").doesNotExist());

        verifyNoInteractions(evaluations);
    }

    @Test
    void invalidApplicationUuidReturnsStandardValidationError()
        throws Exception {
        mvc.perform(requestForApplication(
            "not-a-uuid",
            EVALUATOR_ID.toString(),
            "RECRUITER",
            validBody()
        ))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.message")
                .value("Request body or parameter has an invalid format"))
            .andExpect(jsonPath("$.details").doesNotExist());

        verifyNoInteractions(evaluations);
    }

    @Test
    void openApiDeclaresCreatedSecurityAndErrorResponses() throws Exception {
        Method create = ApplicationEvaluationController.class.getMethod(
            "create",
            JwtAuthenticationToken.class,
            String.class,
            UUID.class,
            CreateEvaluationRequest.class
        );
        ApiResponses responses = create.getAnnotation(ApiResponses.class);
        SecurityRequirement security = ApplicationEvaluationController.class
            .getAnnotation(SecurityRequirement.class);

        assertThat(responses).isNotNull();
        assertThat(Arrays.stream(responses.value())
            .map(response -> response.responseCode()))
            .containsExactlyInAnyOrder(
                "201",
                "400",
                "401",
                "403",
                "404",
                "409",
                "503"
            );
        assertThat(security).isNotNull();
        assertThat(security.name()).isEqualTo("bearerAuth");
    }

    private MockHttpServletRequestBuilder recruiterRequest(String body) {
        return request(EVALUATOR_ID.toString(), "RECRUITER", body);
    }

    private MockHttpServletRequestBuilder request(
        String subject,
        String role,
        String body
    ) {
        return requestForApplication(
            APPLICATION_ID.toString(),
            subject,
            role,
            body
        );
    }

    private MockHttpServletRequestBuilder requestForApplication(
        String applicationId,
        String subject,
        String role,
        String body
    ) {
        when(jwtDecoder.decode("recruiter-token")).thenReturn(Jwt
            .withTokenValue("recruiter-token")
            .header("alg", "RS256")
            .subject(subject)
            .claim("role", role)
            .issuedAt(CREATED_AT.minusSeconds(60))
            .expiresAt(CREATED_AT.plusSeconds(3600))
            .build());
        return post("/{applicationId}/evaluation", applicationId)
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    }

    private String validBody() {
        return """
            {
              "score": 85.50,
              "criteria": {"technical": 90},
              "note": "Strong candidate"
            }
            """;
    }
}
