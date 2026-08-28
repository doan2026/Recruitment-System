package com.recruitment.application.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
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
    private final JwtDecoder jwtDecoder = mock(JwtDecoder.class);

    @Test
    void acceptsStrongNonPlaceholderConfiguration() {
        assertThatCode(() -> new InternalInterviewAuthenticationFilter(
            INTERVIEW_KEY,
            jwtDecoder
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
                    jwtDecoder
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
                    jwtDecoder
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
                jwtDecoder
            )
        ).doesNotThrowAnyException();
    }
}
