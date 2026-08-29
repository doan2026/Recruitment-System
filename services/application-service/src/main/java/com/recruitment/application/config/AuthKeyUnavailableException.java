package com.recruitment.application.config;

import org.springframework.security.oauth2.jwt.JwtException;

public final class AuthKeyUnavailableException extends JwtException {
    public AuthKeyUnavailableException() {
        super("Auth signing keys are unavailable");
    }
}
