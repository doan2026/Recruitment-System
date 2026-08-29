package com.recruitment.application.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;

class StrictBearerTokenResolverTest {
    private static final String TOKEN = "header.payload.signature";

    private final StrictBearerTokenResolver resolver =
        new StrictBearerTokenResolver();

    @Test
    void returnsNullWhenAuthorizationIsAbsent() {
        assertThat(resolver.resolve(new MockHttpServletRequest())).isNull();
    }

    @Test
    void acceptsOneCaseInsensitiveBearerHeaderWithOneAsciiSpace() {
        MockHttpServletRequest request = request("bearer " + TOKEN);

        assertThat(resolver.resolve(request)).isEqualTo(TOKEN);
    }

    @Test
    void acceptsACompactTokenOfExactlyEightKibibytes() {
        String token = "a".repeat(8188) + ".b.c";

        assertThat(token).hasSize(StrictBearerTokenResolver.MAX_TOKEN_BYTES);
        assertThat(resolver.resolve(request("Bearer " + token)))
            .isEqualTo(token);
    }

    @Test
    void rejectsDuplicateAuthorizationHeaders() {
        MockHttpServletRequest request = request("Bearer " + TOKEN);
        request.addHeader("authorization", "Bearer " + TOKEN);

        assertMalformed(request);
    }

    @Test
    void rejectsEveryNonCanonicalAuthorizationValue() {
        for (String value : new String[] {
            "",
            "Bearer ",
            "Bearer  " + TOKEN,
            "Bearer\t" + TOKEN,
            "Token " + TOKEN,
            "Bearer header.payload",
            "Bearer header..signature",
            "Bearer header.pay+load.signature",
            "Bearer header.payload.signature=",
            "Bearer " + TOKEN + " ",
            "Bearer " + TOKEN + ",Bearer " + TOKEN,
            "Bearer " + "a".repeat(8189) + ".b.c"
        }) {
            assertMalformed(request(value));
        }
    }

    private void assertMalformed(MockHttpServletRequest request) {
        assertThatThrownBy(() -> resolver.resolve(request))
            .isInstanceOf(OAuth2AuthenticationException.class)
            .hasMessage(
                "Bearer access token does not use the canonical format"
            )
            .hasMessageNotContaining(TOKEN);
    }

    private MockHttpServletRequest request(String authorization) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", authorization);
        return request;
    }
}
