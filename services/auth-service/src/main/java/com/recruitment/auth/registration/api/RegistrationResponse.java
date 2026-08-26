package com.recruitment.auth.registration.api;

import java.util.UUID;

public record RegistrationResponse(
    String status, long expiresInSeconds, UUID registrationId) {}
