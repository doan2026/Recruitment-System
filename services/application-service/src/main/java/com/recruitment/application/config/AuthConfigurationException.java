package com.recruitment.application.config;

public final class AuthConfigurationException extends IllegalStateException {
    public AuthConfigurationException() {
        super("JWT verification is not configured safely");
    }
}
