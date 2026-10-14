package com.recruitment.auth.dto.passwordreset;


public record ForgotPasswordResponse(String status, long expiresInSeconds) {}
