package com.recruitment.auth.registration.api;

import com.recruitment.auth.identity.UserRole;
import java.util.UUID;

public record OtpVerificationResponse(
    UUID userId,
    String email,
    UserRole role,
    boolean verified) {}
