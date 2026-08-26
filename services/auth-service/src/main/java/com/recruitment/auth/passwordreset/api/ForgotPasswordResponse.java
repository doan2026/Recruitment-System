package com.recruitment.auth.passwordreset.api;

public record ForgotPasswordResponse(String status, long expiresInSeconds) {}
