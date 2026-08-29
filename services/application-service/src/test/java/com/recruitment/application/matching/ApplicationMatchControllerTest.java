package com.recruitment.application.matching;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
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
    value = ApplicationMatchController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class ApplicationMatchControllerTest {
    private static final UUID APPLICATION_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final String TOKEN = "header.payload.signature";
    private static final String AUTHORIZATION = "Bearer " + TOKEN;
    private static final Instant NOW = Instant.parse(
        "2026-08-25T10:15:30Z"
    );

    @Autowired
    private MockMvc mvc;

    @MockBean
    private ApplicationMatchService matching;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void recruiterRefreshesMatchScore() throws Exception {
        when(matching.refresh(
            eq(APPLICATION_ID),
            eq(RECRUITER_ID),
            eq(AUTHORIZATION),
            any(RefreshMatchScoreRequest.class)
        )).thenReturn(new ApplicationMatchScoreResponse(
            APPLICATION_ID,
            new BigDecimal("85.46"),
            3L
        ));

        mvc.perform(request(
            APPLICATION_ID.toString(),
            RECRUITER_ID.toString(),
            "RECRUITER",
            """
            {"expectedVersion": 2}
            """
        ))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.applicationId")
                .value(APPLICATION_ID.toString()))
            .andExpect(jsonPath("$.data.matchScore").value(85.46))
            .andExpect(jsonPath("$.data.version").value(3))
            .andExpect(jsonPath("$.meta").doesNotExist());

        ArgumentCaptor<RefreshMatchScoreRequest> request =
            ArgumentCaptor.forClass(RefreshMatchScoreRequest.class);
        verify(matching).refresh(
            eq(APPLICATION_ID),
            eq(RECRUITER_ID),
            eq(AUTHORIZATION),
            request.capture()
        );
        assertThat(request.getValue().expectedVersion()).isEqualTo(2L);
    }

    @Test
    void candidateCannotRefreshMatchScore() throws Exception {
        mvc.perform(request(
            APPLICATION_ID.toString(),
            UUID.randomUUID().toString(),
            "CANDIDATE",
            """
            {"expectedVersion": 0}
            """
        )).andExpect(status().isForbidden());

        verifyNoInteractions(matching);
    }

    @Test
    void unauthenticatedRequestIsRejected() throws Exception {
        mvc.perform(post("/" + APPLICATION_ID + "/match-score/refresh")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"expectedVersion": 0}
                """))
            .andExpect(status().isUnauthorized());

        verifyNoInteractions(matching);
    }

    @Test
    void invalidJwtSubjectReturnsUnauthorized() throws Exception {
        mvc.perform(request(
            APPLICATION_ID.toString(),
            "not-a-uuid",
            "RECRUITER",
            """
            {"expectedVersion": 0}
            """
        ))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INVALID_TOKEN_SUBJECT"));

        verifyNoInteractions(matching);
    }

    @Test
    void missingExpectedVersionFailsValidation() throws Exception {
        mvc.perform(request(
            APPLICATION_ID.toString(),
            RECRUITER_ID.toString(),
            "RECRUITER",
            "{}"
        ))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.details.expectedVersion").exists());

        verifyNoInteractions(matching);
    }

    @Test
    void negativeExpectedVersionFailsValidation() throws Exception {
        mvc.perform(request(
            APPLICATION_ID.toString(),
            RECRUITER_ID.toString(),
            "RECRUITER",
            """
            {"expectedVersion": -1}
            """
        ))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.details.expectedVersion").exists());

        verifyNoInteractions(matching);
    }

    @Test
    void malformedApplicationIdReturnsStandardValidationError()
        throws Exception {
        mvc.perform(request(
            "not-a-uuid",
            RECRUITER_ID.toString(),
            "RECRUITER",
            """
            {"expectedVersion": 0}
            """
        ))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        verifyNoInteractions(matching);
    }

    @Test
    void openApiDeclaresSecurityAndAllOperationalResponses()
        throws Exception {
        Method refresh = ApplicationMatchController.class.getMethod(
            "refresh",
            JwtAuthenticationToken.class,
            String.class,
            UUID.class,
            RefreshMatchScoreRequest.class
        );
        ApiResponses responses = refresh.getAnnotation(ApiResponses.class);
        SecurityRequirement security = ApplicationMatchController.class
            .getAnnotation(SecurityRequirement.class);

        assertThat(responses).isNotNull();
        assertThat(Arrays.stream(responses.value())
            .map(response -> response.responseCode()))
            .containsExactlyInAnyOrder(
                "200",
                "400",
                "401",
                "403",
                "404",
                "409",
                "502",
                "503"
            );
        assertThat(security).isNotNull();
        assertThat(security.name()).isEqualTo("bearerAuth");
    }

    private MockHttpServletRequestBuilder request(
        String applicationId,
        String subject,
        String role,
        String body
    ) {
        when(jwtDecoder.decode(TOKEN)).thenReturn(Jwt
            .withTokenValue(TOKEN)
            .header("alg", "RS256")
            .subject(subject)
            .claim("role", role)
            .issuedAt(NOW.minusSeconds(60))
            .expiresAt(NOW.plusSeconds(3600))
            .build());
        return post("/" + applicationId + "/match-score/refresh")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    }
}
