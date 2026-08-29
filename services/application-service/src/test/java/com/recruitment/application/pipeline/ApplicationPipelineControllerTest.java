package com.recruitment.application.pipeline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(
    value = ApplicationPipelineController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class ApplicationPipelineControllerTest {
    private static final UUID RECRUITER_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000001"
    );
    private static final String TOKEN = "header.payload.signature";
    private static final String AUTHORIZATION = "Bearer " + TOKEN;
    private static final Instant NOW = Instant.parse(
        "2026-08-28T08:00:00Z"
    );
    private static final Instant FROM = NOW.minusSeconds(3600);

    @Autowired
    private MockMvc mvc;

    @MockBean
    private ApplicationPipelineService pipeline;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void recruiterSkillFiltersAreForwardedWithoutSharedCaching()
        throws Exception {
        when(pipeline.listForRecruiter(
            eq(RECRUITER_ID),
            eq(AUTHORIZATION),
            eq(null),
            eq(ApplicationStatus.APPLIED),
            eq(FROM),
            eq(NOW),
            anyList(),
            eq(ApplicationSort.MATCH_SCORE_DESC),
            eq(2),
            eq(10)
        )).thenReturn(new RecruiterApplicationPageResponse(
            List.of(),
            2,
            10,
            0,
            0
        ));

        stubJwt(RECRUITER_ID.toString(), "RECRUITER");
        mvc.perform(get("/")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .param("status", "APPLIED")
            .param("appliedFrom", FROM.toString())
            .param("appliedTo", NOW.toString())
            .param("skills", "Java,Spring Boot", "Kotlin")
            .param("sort", "MATCH_SCORE_DESC")
            .param("page", "2")
            .param("size", "10"))
            .andExpect(status().isOk())
            .andExpect(header().string(
                HttpHeaders.CACHE_CONTROL,
                "private, no-store"
            ))
            .andExpect(result -> assertThat(result.getResponse()
                .getHeaders(HttpHeaders.VARY))
                .contains(HttpHeaders.AUTHORIZATION))
            .andExpect(jsonPath("$.data.items").isEmpty())
            .andExpect(jsonPath("$.data.page").value(2));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> skills = ArgumentCaptor.forClass(
            List.class
        );
        verify(pipeline).listForRecruiter(
            eq(RECRUITER_ID),
            eq(AUTHORIZATION),
            eq(null),
            eq(ApplicationStatus.APPLIED),
            eq(FROM),
            eq(NOW),
            skills.capture(),
            eq(ApplicationSort.MATCH_SCORE_DESC),
            eq(2),
            eq(10)
        );
        assertThat(skills.getValue())
            .containsExactly("Java,Spring Boot", "Kotlin");
    }

    @Test
    void candidateCannotListRecruiterApplications() throws Exception {
        stubJwt(UUID.randomUUID().toString(), "CANDIDATE");

        mvc.perform(get("/")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION))
            .andExpect(status().isForbidden());

        verifyNoInteractions(pipeline);
    }

    @Test
    void invalidSubjectFailsBeforePipelineCall() throws Exception {
        stubJwt("not-a-uuid", "RECRUITER");

        mvc.perform(get("/")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INVALID_TOKEN_SUBJECT"));

        verifyNoInteractions(pipeline);
    }

    private void stubJwt(String subject, String role) {
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
