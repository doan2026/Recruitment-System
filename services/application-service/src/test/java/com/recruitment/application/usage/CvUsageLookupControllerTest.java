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
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
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
    value = CvUsageLookupController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class CvUsageLookupControllerTest {
    private static final String INTERNAL_KEY =
        "profile-to-application-test-key-0000000000000001";
    private static final UUID CANDIDATE_ID = UUID.randomUUID();
    private static final UUID CV_ID = UUID.randomUUID();
    private static final Instant FIRST_USED_AT = Instant.parse(
        "2026-08-27T08:00:00Z"
    );

    @Autowired
    private MockMvc mvc;

    @MockBean
    private CvUsageLookupService usages;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void profileServiceLooksUpUsageWithNoStoreResponse() throws Exception {
        CvUsageLookupRequest request = new CvUsageLookupRequest(
            CANDIDATE_ID,
            CV_ID
        );
        when(usages.lookup(request)).thenReturn(new CvUsageLookupResponse(
            CANDIDATE_ID,
            CV_ID,
            true,
            FIRST_USED_AT,
            2
        ));

        mvc.perform(validRequest())
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.data.candidateId")
                .value(CANDIDATE_ID.toString()))
            .andExpect(jsonPath("$.data.cvId").value(CV_ID.toString()))
            .andExpect(jsonPath("$.data.used").value(true))
            .andExpect(jsonPath("$.data.applicationCount").value(2));

        verify(usages).lookup(request);
    }

    @ParameterizedTest
    @MethodSource("invalidCredentials")
    void invalidInternalCredentialsReturnSameGenericNoStoreError(
        String caller,
        String key,
        String authorization
    ) throws Exception {
        MockHttpServletRequestBuilder request = request();
        if (caller != null) {
            request.header("X-Internal-Service", caller);
        }
        if (key != null) {
            request.header("X-Internal-Api-Key", key);
        }
        if (authorization != null) {
            request.header(HttpHeaders.AUTHORIZATION, authorization);
        }

        mvc.perform(request)
            .andExpect(status().isUnauthorized())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"))
            .andExpect(jsonPath("$.message").value(
                "Internal service authentication failed"
            ));
        verifyNoInteractions(usages);
    }

    @Test
    void duplicateAuthenticationHeadersAreRejectedGenerically()
        throws Exception {
        mvc.perform(request()
            .header(
                "X-Internal-Service",
                "profile-service",
                "profile-service"
            )
            .header("X-Internal-Api-Key", INTERNAL_KEY, INTERNAL_KEY))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.code").value("INTERNAL_AUTH_INVALID"));
        verifyNoInteractions(usages);
    }

    @Test
    void unknownRequestFieldsFailValidationAfterInternalAuth()
        throws Exception {
        mvc.perform(post("/internal/v1/cv-usages/lookup")
            .header("X-Internal-Service", "profile-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY)
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "candidateId": "%s",
                  "cvId": "%s",
                  "unexpected": true
                }
                """.formatted(CANDIDATE_ID, CV_ID)))
            .andExpect(status().isBadRequest())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
        verifyNoInteractions(usages);
    }

    @Test
    void pathNormalizationVariantsCannotBypassInternalAuthentication()
        throws Exception {
        for (String path : new String[] {
            "/internal;probe/v1/cv-usages/lookup",
            "/internal/%76%31/cv-usages/lookup",
            "//internal/v1/cv-usages/lookup"
        }) {
            mvc.perform(post(path)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body()))
                .andExpect(result -> assertThat(
                    result.getResponse().getStatus()
                ).isBetween(400, 499));
        }
        verifyNoInteractions(usages);
    }

    @Test
    void internalControllerIsHiddenFromOpenApi() {
        assertThat(CvUsageLookupController.class.getAnnotation(Hidden.class))
            .isNotNull();
    }

    private MockHttpServletRequestBuilder validRequest() {
        return request()
            .header("X-Internal-Service", "profile-service")
            .header("X-Internal-Api-Key", INTERNAL_KEY);
    }

    private MockHttpServletRequestBuilder request() {
        return post("/internal/v1/cv-usages/lookup")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body());
    }

    private String body() {
        return """
            {"candidateId":"%s","cvId":"%s"}
            """.formatted(CANDIDATE_ID, CV_ID);
    }

    static Stream<Arguments> invalidCredentials() {
        return Stream.of(
            Arguments.of(null, null, null),
            Arguments.of("profile-service", null, null),
            Arguments.of(null, INTERNAL_KEY, null),
            Arguments.of("application-service", INTERNAL_KEY, null),
            Arguments.of("profile-service", "wrong-key", null),
            Arguments.of("profile-service", "x".repeat(200), null),
            Arguments.of(null, null, "Bearer header.payload.signature")
        );
    }
}
