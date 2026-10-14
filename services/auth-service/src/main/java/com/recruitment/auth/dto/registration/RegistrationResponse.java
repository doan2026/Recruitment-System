package com.recruitment.auth.dto.registration;

import java.util.UUID;

public record RegistrationResponse(
    String status, long expiresInSeconds, UUID registrationId) {}
