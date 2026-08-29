package com.recruitment.application.config;

import org.springframework.security.oauth2.jwt.BadJwtException;

public final class InvalidAccessTokenException extends BadJwtException {
    public InvalidAccessTokenException() {
        super("Access token is invalid or expired");
    }
}
