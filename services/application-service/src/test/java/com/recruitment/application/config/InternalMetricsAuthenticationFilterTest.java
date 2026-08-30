package com.recruitment.application.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class InternalMetricsAuthenticationFilterTest {
    private static final String KEY =
        "application-metrics-scrape-key-000000001";

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void aScrapeWithTheExactKeyIsAuthorised() throws Exception {
        MockHttpServletRequest request = request(KEY);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = new MockFilterChain();

        new InternalMetricsAuthenticationFilter(KEY)
            .doFilter(request, response, chain);

        assertThat(SecurityContextHolder.getContext().getAuthentication())
            .isNotNull()
            .satisfies(authentication ->
                assertThat(authentication.getAuthorities())
                    .extracting(Object::toString)
                    .containsExactly("ROLE_INTERNAL_METRICS")
            );
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    }

    @Test
    void aMissingKeyIsRejectedWithoutRevealingWhatWasExpected()
        throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new InternalMetricsAuthenticationFilter(KEY)
            .doFilter(request(null), response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString())
            .contains("INTERNAL_AUTH_INVALID")
            .doesNotContain(KEY);
        assertThat(SecurityContextHolder.getContext().getAuthentication())
            .isNull();
    }

    @Test
    void aWrongKeyIsRejected() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new InternalMetricsAuthenticationFilter(KEY).doFilter(
            request("another-key-that-is-long-enough-000001"),
            response,
            new MockFilterChain()
        );

        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void aDuplicatedKeyHeaderIsRejected() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Internal-Api-Key", KEY);
        request.addHeader("X-Internal-Api-Key", KEY);
        MockHttpServletResponse response = new MockHttpServletResponse();

        new InternalMetricsAuthenticationFilter(KEY)
            .doFilter(request, response, new MockFilterChain());

        // Two headers let a proxy and a caller disagree about the credential.
        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void aCommaSeparatedKeyHeaderIsRejected() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new InternalMetricsAuthenticationFilter(KEY)
            .doFilter(request(KEY + ",other"), response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(401);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "",
        "too-short",
        "replace-with-a-distinct-metrics-scrape-key",
        "  padded-key-that-is-long-enough-0000001  "
    })
    void aPlaceholderOrWeakKeyIsRefusedAtStartup(String key) {
        assertThatThrownBy(() -> new InternalMetricsAuthenticationFilter(key))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("INTERNAL_API_KEY_METRICS");
    }

    @Test
    void aNullKeyIsRefusedAtStartup() {
        assertThatThrownBy(() -> new InternalMetricsAuthenticationFilter(null))
            .isInstanceOf(IllegalStateException.class);
    }

    private MockHttpServletRequest request(String key) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/actuator/prometheus");
        if (key != null) {
            request.addHeader("X-Internal-Api-Key", key);
        }
        return request;
    }
}
