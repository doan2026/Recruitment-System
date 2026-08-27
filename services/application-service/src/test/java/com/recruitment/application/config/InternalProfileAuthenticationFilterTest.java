package com.recruitment.application.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class InternalProfileAuthenticationFilterTest {
    private static final String VALID_KEY =
        "profile-to-application-test-key-0000000000000001";

    private static final String OUTBOUND_KEY =
        "application-to-profile-test-key-0000000000000001";

    @Test
    void acceptsStrongNonPlaceholderConfiguration() {
        assertThatCode(() -> new InternalProfileAuthenticationFilter(
            VALID_KEY
        )).doesNotThrowAnyException();
    }

    @Test
    void rejectsMissingShortPlaceholderOrControlCharacterConfiguration() {
        for (String invalid : new String[] {
            null,
            "short-key",
            "replace-with-profile-internal-key-000000000000",
            VALID_KEY + "\t",
            "\n" + VALID_KEY
        }) {
            assertThatThrownBy(() ->
                new InternalProfileAuthenticationFilter(invalid)
            ).isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void directionalProfileKeysMustBeDistinct() {
        SecurityConfig config = new SecurityConfig();

        assertThatThrownBy(() ->
            config.internalProfileAuthenticationFilter(VALID_KEY, VALID_KEY)
        ).isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("must be distinct");

        assertThatCode(() -> config.internalProfileAuthenticationFilter(
            VALID_KEY,
            OUTBOUND_KEY
        )).doesNotThrowAnyException();
    }
}
