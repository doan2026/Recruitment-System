package com.recruitment.application.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;

class SecurityAuthenticationEntryPointTest {
    private static final String PRIVATE_DETAIL =
        "private-token-and-upstream-detail";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SecurityAuthenticationEntryPoint entryPoint =
        new SecurityAuthenticationEntryPoint(objectMapper);

    @Test
    void mapsInvalidAndMissingCredentialsToSanitizedUnauthorized() throws Exception {
        assertFailure(
            new InvalidBearerTokenException(
                "invalid bearer",
                new BadJwtException(PRIVATE_DETAIL)
            ),
            401,
            "UNAUTHORIZED",
            "Access token is invalid or expired"
        );
        assertFailure(
            new InsufficientAuthenticationException(PRIVATE_DETAIL),
            401,
            "UNAUTHORIZED",
            "Access token is invalid or expired"
        );
    }

    @Test
    void mapsSigningKeyOutageToSanitizedServiceUnavailable()
        throws Exception {
        assertFailure(
            new AuthenticationServiceException(
                PRIVATE_DETAIL,
                new AuthKeyUnavailableException()
            ),
            503,
            "AUTH_KEY_UNAVAILABLE",
            "Access token verification key is temporarily unavailable"
        );
    }

    @Test
    void mapsUnexpectedAuthenticationFailureToSanitizedInternalError()
        throws Exception {
        assertFailure(
            new AuthenticationServiceException(PRIVATE_DETAIL),
            500,
            "INTERNAL_SERVER_ERROR",
            "Internal server error"
        );
    }

    private void assertFailure(
        org.springframework.security.core.AuthenticationException exception,
        int status,
        String code,
        String message
    ) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        entryPoint.commence(
            new MockHttpServletRequest(),
            response,
            exception
        );

        assertThat(response.getStatus()).isEqualTo(status);
        assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL))
            .isEqualTo("no-store");
        assertThat(response.getHeader(HttpHeaders.PRAGMA))
            .isEqualTo("no-cache");
        assertThat(response.getContentType())
            .startsWith("application/json");
        JsonNode body = objectMapper.readTree(response.getContentAsByteArray());
        assertThat(body.path("code").asText()).isEqualTo(code);
        assertThat(body.path("message").asText()).isEqualTo(message);
        assertThat(body.path("details").isNull()).isTrue();
        assertThat(response.getContentAsString())
            .doesNotContain(PRIVATE_DETAIL);
    }
}
