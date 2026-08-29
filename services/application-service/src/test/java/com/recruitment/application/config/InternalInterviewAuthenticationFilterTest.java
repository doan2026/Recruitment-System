package com.recruitment.application.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

class InternalInterviewAuthenticationFilterTest {
    private static final String INTERVIEW_KEY =
        "interview-to-application-test-key-000000000000001";
    private static final String PROFILE_INBOUND_KEY =
        "profile-to-application-test-key-0000000000000001";
    private static final String PROFILE_OUTBOUND_KEY =
        "application-to-profile-test-key-0000000000000001";
    private static final String SHARED_KEY =
        "application-shared-test-key-000000000000000000001";
    private static final String TOKEN = "header.payload.signature";
    private static final String RECRUITER_ID =
        "35ed14a5-b031-4789-bec5-a80a1c19d60b";
    private final JwtDecoder jwtDecoder = mock(JwtDecoder.class);
    private final StrictBearerTokenResolver bearerTokenResolver =
        new StrictBearerTokenResolver();

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void acceptsStrongNonPlaceholderConfiguration() {
        assertThatCode(() -> new InternalInterviewAuthenticationFilter(
            INTERVIEW_KEY,
            jwtDecoder,
            bearerTokenResolver
        )).doesNotThrowAnyException();
    }

    @Test
    void rejectsMissingShortPlaceholderOrControlCharacterConfiguration() {
        for (String invalid : new String[] {
            null,
            "short-key",
            "replace-with-interview-internal-key-00000000000",
            INTERVIEW_KEY + "\t",
            "\n" + INTERVIEW_KEY
        }) {
            assertThatThrownBy(() ->
                new InternalInterviewAuthenticationFilter(
                    invalid,
                    jwtDecoder,
                    bearerTokenResolver
                )
            ).isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void interviewKeyMustDifferFromEveryOtherDirection() {
        SecurityConfig config = new SecurityConfig();

        for (String duplicate : new String[] {
            PROFILE_INBOUND_KEY,
            PROFILE_OUTBOUND_KEY,
            SHARED_KEY
        }) {
            assertThatThrownBy(() ->
                config.internalInterviewAuthenticationFilter(
                    duplicate,
                    PROFILE_INBOUND_KEY,
                    PROFILE_OUTBOUND_KEY,
                    SHARED_KEY,
                    jwtDecoder,
                    bearerTokenResolver
                )
            ).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be distinct");
        }

        assertThatCode(() ->
            config.internalInterviewAuthenticationFilter(
                INTERVIEW_KEY,
                PROFILE_INBOUND_KEY,
                PROFILE_OUTBOUND_KEY,
                SHARED_KEY,
                jwtDecoder,
                bearerTokenResolver
            )
        ).doesNotThrowAnyException();
    }

    @Test
    void authenticatesCanonicalRecruiterTokenAfterInternalHeaders()
        throws Exception {
        when(jwtDecoder.decode(TOKEN)).thenReturn(recruiterJwt());
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter().doFilter(authenticatedRequest(), response, chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(chain.getRequest()).isNotNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication())
            .satisfies(authentication -> {
                assertThat(authentication.getName()).isEqualTo(RECRUITER_ID);
                assertThat(authentication.getAuthorities())
                    .extracting("authority")
                    .containsExactlyInAnyOrder(
                        "ROLE_INTERNAL_INTERVIEW",
                        "ROLE_RECRUITER"
                    );
            });
    }

    @Test
    void rejectsDuplicateBearerHeadersBeforeDecoding() throws Exception {
        MockHttpServletRequest request = authenticatedRequest();
        request.addHeader("authorization", "Bearer " + TOKEN);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter().doFilter(request, response, new MockFilterChain());

        assertSecurityFailure(response, 401, "INTERNAL_AUTH_INVALID");
        verifyNoInteractions(jwtDecoder);
    }

    @Test
    void preservesInternalBoundaryBeforeParsingTheBearerHeader()
        throws Exception {
        MockHttpServletRequest request = authenticatedRequest();
        request.removeHeader("X-Internal-Service");
        request.addHeader("X-Internal-Service", "untrusted-service");
        request.addHeader("authorization", "Bearer " + TOKEN);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter().doFilter(request, response, new MockFilterChain());

        assertSecurityFailure(response, 401, "INTERNAL_AUTH_INVALID");
        verifyNoInteractions(jwtDecoder);
    }

    @Test
    void mapsDecoderFailuresWithoutLeakingTheirDetails() throws Exception {
        assertDecoderFailure(
            new InvalidAccessTokenException(),
            401,
            "INTERNAL_AUTH_INVALID"
        );
        assertDecoderFailure(
            new AuthKeyUnavailableException(),
            503,
            "AUTH_KEY_UNAVAILABLE"
        );
        assertDecoderFailure(
            new IllegalStateException("private decoder detail " + TOKEN),
            500,
            "INTERNAL_SERVER_ERROR"
        );
    }

    private void assertDecoderFailure(
        RuntimeException failure,
        int status,
        String code
    ) throws Exception {
        doThrow(failure).when(jwtDecoder).decode(TOKEN);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter().doFilter(
            authenticatedRequest(),
            response,
            new MockFilterChain()
        );

        assertSecurityFailure(response, status, code);
        assertThat(response.getContentAsString())
            .doesNotContain(TOKEN)
            .doesNotContain("private decoder detail");
    }

    private void assertSecurityFailure(
        MockHttpServletResponse response,
        int status,
        String code
    ) throws Exception {
        assertThat(response.getStatus()).isEqualTo(status);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(response.getHeader("Pragma")).isEqualTo("no-cache");
        assertThat(response.getContentAsString())
            .contains("\"code\":\"" + code + "\"")
            .doesNotContain(TOKEN);
        assertThat(SecurityContextHolder.getContext().getAuthentication())
            .isNull();
    }

    private InternalInterviewAuthenticationFilter filter() {
        return new InternalInterviewAuthenticationFilter(
            INTERVIEW_KEY,
            jwtDecoder,
            bearerTokenResolver
        );
    }

    private MockHttpServletRequest authenticatedRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest(
            "POST",
            "/internal/v1/interview-scheduling/authorize"
        );
        request.addHeader("X-Internal-Service", "interview-service");
        request.addHeader("X-Internal-Api-Key", INTERVIEW_KEY);
        request.addHeader("Authorization", "Bearer " + TOKEN);
        return request;
    }

    private Jwt recruiterJwt() {
        Instant now = Instant.now();
        return Jwt.withTokenValue(TOKEN)
            .header("alg", "RS256")
            .claim("sub", RECRUITER_ID)
            .claim("role", "RECRUITER")
            .issuedAt(now)
            .expiresAt(now.plusSeconds(900))
            .build();
    }
}
