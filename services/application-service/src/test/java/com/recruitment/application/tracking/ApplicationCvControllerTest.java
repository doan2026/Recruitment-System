package com.recruitment.application.tracking;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(
    value = ApplicationCvController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class ApplicationCvControllerTest {
    private static final UUID APPLICATION_ID = UUID.randomUUID();
    private static final UUID RECRUITER_ID = UUID.randomUUID();
    private static final UUID CANDIDATE_ID = UUID.randomUUID();
    private static final UUID CV_ID = UUID.randomUUID();
    private static final String TOKEN = "application-cv-token";
    private static final String AUTHORIZATION = "Bearer " + TOKEN;
    private static final Instant NOW = Instant.parse(
        "2026-08-27T08:00:00Z"
    );

    @Autowired
    private MockMvc mvc;

    @MockBean
    private ApplicationCvService cvs;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void recruiterGetsCvMetadataWithoutCaching() throws Exception {
        when(cvs.getCv(APPLICATION_ID, RECRUITER_ID, AUTHORIZATION))
            .thenReturn(new ApplicationCvResponse(
                CV_ID,
                "Backend CV",
                "UPLOAD",
                true,
                NOW.minusSeconds(60)
            ));

        mvc.perform(authenticated(
            get("/{applicationId}/cv", APPLICATION_ID),
            RECRUITER_ID.toString(),
            "RECRUITER"
        ))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.data.cvId").value(CV_ID.toString()))
            .andExpect(jsonPath("$.data.candidateId").doesNotExist())
            .andExpect(jsonPath("$.data.fileId").doesNotExist())
            .andExpect(jsonPath("$.data.isDefault").doesNotExist())
            .andExpect(jsonPath("$.data.firstUsedAt").doesNotExist())
            .andExpect(jsonPath("$.data.aggregateVersion").doesNotExist())
            .andExpect(jsonPath("$.data.updatedAt").doesNotExist())
            .andExpect(jsonPath("$.data.isDeleted").value(true))
            .andExpect(jsonPath("$.data.createdAt").exists());

        verify(cvs).getCv(APPLICATION_ID, RECRUITER_ID, AUTHORIZATION);
    }

    @Test
    void recruiterCreatesShortLivedDownloadWithoutCaching()
        throws Exception {
        when(cvs.createDownloadUrl(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new ApplicationCvDownloadResponse(
            CV_ID,
            "https://media.example/private.pdf?token=short",
            NOW.plusSeconds(300)
        ));

        mvc.perform(authenticated(
            post("/{applicationId}/cv/download-url", APPLICATION_ID),
            RECRUITER_ID.toString(),
            "RECRUITER"
        ))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.data.cvId").value(CV_ID.toString()))
            .andExpect(jsonPath("$.data.candidateId").doesNotExist())
            .andExpect(jsonPath("$.data.url").value(
                "https://media.example/private.pdf?token=short"
            ));

        verify(cvs).createDownloadUrl(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        );
    }

    @Test
    void candidateAndAnonymousCannotUseRecruiterCvEndpoints()
        throws Exception {
        mvc.perform(authenticated(
            get("/{applicationId}/cv", APPLICATION_ID),
            CANDIDATE_ID.toString(),
            "CANDIDATE"
        )).andExpect(status().isForbidden());

        mvc.perform(post("/{applicationId}/cv/download-url", APPLICATION_ID))
            .andExpect(status().isUnauthorized());

        verifyNoInteractions(cvs);
    }

    @Test
    void invalidRecruiterSubjectFailsBeforeServiceCall() throws Exception {
        mvc.perform(authenticated(
            get("/{applicationId}/cv", APPLICATION_ID),
            "not-a-uuid",
            "RECRUITER"
        ))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INVALID_TOKEN_SUBJECT"));
        verifyNoInteractions(cvs);
    }

    private MockHttpServletRequestBuilder authenticated(
        MockHttpServletRequestBuilder request,
        String subject,
        String role
    ) {
        when(jwtDecoder.decode(TOKEN)).thenReturn(Jwt
            .withTokenValue(TOKEN)
            .header("alg", "RS256")
            .subject(subject)
            .claim("role", role)
            .issuedAt(NOW.minusSeconds(60))
            .expiresAt(NOW.plusSeconds(3600))
            .build());
        return request.header(HttpHeaders.AUTHORIZATION, AUTHORIZATION);
    }
}
