package com.recruitment.application.usage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import io.swagger.v3.oas.annotations.Hidden;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(
    value = CvDeletionFenceController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class CvDeletionFenceControllerTest {
    private static final String INTERNAL_KEY =
        "profile-to-application-test-key-0000000000000001";
    private static final UUID CANDIDATE_ID = UUID.randomUUID();
    private static final UUID CV_ID = UUID.randomUUID();
    private static final UUID DELETION_REQUEST_ID = UUID.randomUUID();
    private static final Instant FENCED_AT = Instant.parse(
        "2026-08-28T08:00:00Z"
    );

    @Autowired
    private MockMvc mvc;

    @MockBean
    private CvDeletionFenceService fences;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void profileServiceAcquiresFenceWithNoStoreResponse() throws Exception {
        CvDeletionFenceRequest request = requestDto();
        when(fences.acquire(request)).thenReturn(new CvDeletionFenceResponse(
            CANDIDATE_ID,
            CV_ID,
            DELETION_REQUEST_ID,
            CvDeletionFenceDisposition.FENCED,
            FENCED_AT,
            null,
            0
        ));

        mvc.perform(validRequest())
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.data.candidateId")
                .value(CANDIDATE_ID.toString()))
            .andExpect(jsonPath("$.data.cvId").value(CV_ID.toString()))
            .andExpect(jsonPath("$.data.deletionRequestId")
                .value(DELETION_REQUEST_ID.toString()))
            .andExpect(jsonPath("$.data.disposition").value("FENCED"))
            .andExpect(jsonPath("$.data.fencedAt")
                .value(FENCED_AT.toString()))
            .andExpect(jsonPath("$.data.firstUsedAt").isEmpty())
            .andExpect(jsonPath("$.data.applicationCount").value(0));

        verify(fences).acquire(request);
    }

    @Test
    void invalidInternalCredentialsAreRejectedBeforeService()
        throws Exception {
        mvc.perform(request())
            .andExpect(status().isUnauthorized())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));

        mvc.perform(request()
            .header("X-Internal-Service", "profile-service")
            .header("X-Internal-Api-Key", "wrong-key"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));
        verifyNoInteractions(fences);
    }

    @Test
    void unknownRequestFieldsFailClosed() throws Exception {
        mvc.perform(post("/internal/v1/cv-deletion-fences/acquire")
            .header("X-Internal-Service", "profile-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY)
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "candidateId": "%s",
                  "cvId": "%s",
                  "deletionRequestId": "%s",
                  "unexpected": true
                }
                """.formatted(
                    CANDIDATE_ID,
                    CV_ID,
                    DELETION_REQUEST_ID
                )))
            .andExpect(status().isBadRequest())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
        verifyNoInteractions(fences);
    }

    @Test
    void pathNormalizationVariantsCannotBypassInternalAuthentication()
        throws Exception {
        for (String path : new String[] {
            "/internal;probe/v1/cv-deletion-fences/acquire",
            "/internal/%76%31/cv-deletion-fences/acquire",
            "//internal/v1/cv-deletion-fences/acquire"
        }) {
            mvc.perform(post(path)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body()))
                .andExpect(result -> assertThat(
                    result.getResponse().getStatus()
                ).isBetween(400, 499));
        }
        verifyNoInteractions(fences);
    }

    @Test
    void internalControllerIsHiddenFromOpenApi() {
        assertThat(CvDeletionFenceController.class.getAnnotation(Hidden.class))
            .isNotNull();
    }

    private MockHttpServletRequestBuilder validRequest() {
        return request()
            .header("X-Internal-Service", "profile-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY);
    }

    private MockHttpServletRequestBuilder request() {
        return post("/internal/v1/cv-deletion-fences/acquire")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body());
    }

    private String body() {
        return """
            {
              "candidateId": "%s",
              "cvId": "%s",
              "deletionRequestId": "%s"
            }
            """.formatted(CANDIDATE_ID, CV_ID, DELETION_REQUEST_ID);
    }

    private CvDeletionFenceRequest requestDto() {
        return new CvDeletionFenceRequest(
            CANDIDATE_ID,
            CV_ID,
            DELETION_REQUEST_ID
        );
    }
}
