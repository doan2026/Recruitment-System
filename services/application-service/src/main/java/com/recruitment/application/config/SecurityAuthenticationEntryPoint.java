package com.recruitment.application.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.ApiError;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.web.AuthenticationEntryPoint;

/**
 * Produces bounded, non-sensitive authentication failures for HTTP clients.
 */
public final class SecurityAuthenticationEntryPoint
    implements AuthenticationEntryPoint {
    private final ObjectMapper objectMapper;

    public SecurityAuthenticationEntryPoint(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void commence(
        HttpServletRequest request,
        HttpServletResponse response,
        AuthenticationException exception
    ) throws IOException, ServletException {
        SecurityFailure failure = classify(exception);
        response.setStatus(failure.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(java.nio.charset.StandardCharsets.UTF_8.name());
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setHeader(HttpHeaders.PRAGMA, "no-cache");
        objectMapper.writeValue(
            response.getOutputStream(),
            new ApiError(failure.code(), failure.message(), null)
        );
    }

    private SecurityFailure classify(AuthenticationException exception) {
        if (contains(exception, AuthKeyUnavailableException.class)) {
            return new SecurityFailure(
                HttpStatus.SERVICE_UNAVAILABLE,
                "AUTH_KEY_UNAVAILABLE",
                "Access token verification key is temporarily unavailable"
            );
        }
        if (
            contains(exception, InvalidAccessTokenException.class) ||
            contains(exception, BadJwtException.class) ||
            isClientAuthenticationFailure(exception)
        ) {
            return new SecurityFailure(
                HttpStatus.UNAUTHORIZED,
                "UNAUTHORIZED",
                "Access token is invalid or expired"
            );
        }
        return new SecurityFailure(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "INTERNAL_SERVER_ERROR",
            "Internal server error"
        );
    }

    private boolean isClientAuthenticationFailure(
        AuthenticationException exception
    ) {
        if (exception instanceof InvalidBearerTokenException invalid) {
            return invalid.getCause() == null;
        }
        return exception instanceof OAuth2AuthenticationException ||
            exception instanceof InsufficientAuthenticationException ||
            exception instanceof AuthenticationCredentialsNotFoundException;
    }

    private boolean contains(Throwable error, Class<? extends Throwable> type) {
        Throwable current = error;
        for (int depth = 0; current != null && depth < 16; depth++) {
            if (type.isInstance(current)) {
                return true;
            }
            Throwable next = current.getCause();
            if (next == current) {
                break;
            }
            current = next;
        }
        return false;
    }

    private record SecurityFailure(
        HttpStatus status,
        String code,
        String message
    ) {}
}
