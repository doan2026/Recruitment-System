package com.recruitment.application.interview;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(
    value = InterviewSchedulingAuthorizationController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class InterviewSchedulingAuthorizationControllerTest {
    private static final String INTERNAL_KEY =
        "interview-to-application-test-key-000000000000001";
    private static final String TOKEN = "header.payload.signature";
    private static final UUID RECRUITER_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000001"
    );
    private static final UUID APPLICATION_ID = UUID.randomUUID();
    private static final UUID JOB_ID = UUID.randomUUID();
    private static final UUID COMPANY_ID = UUID.randomUUID();
    private static final UUID CANDIDATE_ID = UUID.randomUUID();
    private static final Instant NOW = Instant.parse(
        "2026-08-28T08:00:00Z"
    );

    @Autowired
    private MockMvc mvc;

    @MockBean
    private InterviewSchedulingAuthorizationService authorization;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void validDualAuthenticationReturnsMinimalNoStoreContext()
        throws Exception {
        stubJwt("RECRUITER", RECRUITER_ID.toString());
        when(authorization.authorize(
            APPLICATION_ID,
            RECRUITER_ID,
            "Bearer " + TOKEN
        )).thenReturn(new InterviewSchedulingContextResponse(
            APPLICATION_ID,
            JOB_ID,
            COMPANY_ID,
            CANDIDATE_ID,
            ApplicationStatus.REVIEWING,
            11L
        ));

        mvc.perform(validRequest())
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.data.applicationId")
                .value(APPLICATION_ID.toString()))
            .andExpect(jsonPath("$.data.jobId").value(JOB_ID.toString()))
            .andExpect(jsonPath("$.data.companyId")
                .value(COMPANY_ID.toString()))
            .andExpect(jsonPath("$.data.candidateId")
                .value(CANDIDATE_ID.toString()))
            .andExpect(jsonPath("$.data.status").value("REVIEWING"))
            .andExpect(jsonPath("$.data.applicationVersion").value(11))
            .andExpect(jsonPath("$.data.cvId").doesNotExist())
            .andExpect(jsonPath("$.data.coverLetter").doesNotExist());

        verify(authorization).authorize(
            APPLICATION_ID,
            RECRUITER_ID,
            "Bearer " + TOKEN
        );
    }

    @Test
    void missingOrWrongInternalCredentialsAreRejectedGenerically()
        throws Exception {
        stubJwt("RECRUITER", RECRUITER_ID.toString());

        for (MockHttpServletRequestBuilder request : new MockHttpServletRequestBuilder[] {
            request().header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN),
            request()
                .header("X-Internal-Service", "profile-service")
                .header("X-Internal-Api-Key", INTERNAL_KEY)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN),
            request()
                .header("X-Internal-Service", "interview-service")
                .header("X-Internal-Api-Key", "wrong-key")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN)
        }) {
            mvc.perform(request)
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(
                    HttpHeaders.CACHE_CONTROL,
                    "no-store"
                ))
                .andExpect(jsonPath("$.code").value(
                    "INTERNAL_AUTH_INVALID"
                ));
        }
        verifyNoInteractions(authorization);
    }

    @Test
    void duplicateAuthenticationHeadersAreRejected() throws Exception {
        stubJwt("RECRUITER", RECRUITER_ID.toString());

        mvc.perform(request()
            .header(
                "X-Internal-Service",
                "interview-service",
                "interview-service"
            )
            .header("X-Internal-Api-Key", INTERNAL_KEY, INTERNAL_KEY)
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));

        mvc.perform(request()
            .header("X-Internal-Service", "interview-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY)
            .header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + TOKEN,
                "Bearer " + TOKEN
            ))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));
        verifyNoInteractions(authorization);
    }

    @Test
    void candidateInvalidSubjectAndInvalidJwtUseSameGenericError()
        throws Exception {
        stubJwt("CANDIDATE", RECRUITER_ID.toString());
        mvc.perform(validRequest())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));

        stubJwt("RECRUITER", "not-a-uuid");
        mvc.perform(validRequest())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));

        when(jwtDecoder.decode(TOKEN)).thenThrow(new BadJwtException("bad"));
        mvc.perform(validRequest())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));

        verifyNoInteractions(authorization);
    }

    @Test
    void missingApplicationIdFailsValidationAfterAuthentication()
        throws Exception {
        stubJwt("RECRUITER", RECRUITER_ID.toString());

        mvc.perform(post("/internal/v1/interview-scheduling/authorize")
            .header("X-Internal-Service", "interview-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY)
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        verifyNoInteractions(authorization);
    }

    @Test
    void unknownRequestFieldsAreRejectedAfterAuthentication()
        throws Exception {
        stubJwt("RECRUITER", RECRUITER_ID.toString());

        mvc.perform(post("/internal/v1/interview-scheduling/authorize")
            .header("X-Internal-Service", "interview-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY)
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN)
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"applicationId":"%s","companyId":"%s"}
                """.formatted(APPLICATION_ID, COMPANY_ID)))
            .andExpect(status().isBadRequest())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        verifyNoInteractions(authorization);
    }

    private MockHttpServletRequestBuilder validRequest() {
        return request()
            .header("X-Internal-Service", "interview-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY)
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN);
    }

    private MockHttpServletRequestBuilder request() {
        return post("/internal/v1/interview-scheduling/authorize")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"applicationId\":\"%s\"}".formatted(
                APPLICATION_ID
            ));
    }

    private void stubJwt(String role, String subject) {
        when(jwtDecoder.decode(TOKEN)).thenReturn(Jwt
            .withTokenValue(TOKEN)
            .header("alg", "RS256")
            .subject(subject)
            .claim("role", role)
            .issuedAt(NOW.minusSeconds(60))
            .expiresAt(NOW.plusSeconds(3600))
            .build());
    }
}
