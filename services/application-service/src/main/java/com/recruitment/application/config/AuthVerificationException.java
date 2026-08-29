package com.recruitment.application.config;

import org.springframework.security.oauth2.jwt.JwtException;

public final class AuthVerificationException extends JwtException {
    public AuthVerificationException() {
        super("Access token verification failed");
    }
}
