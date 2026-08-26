package com.recruitment.auth.account.api;

import com.recruitment.auth.identity.UserRole;
import java.util.UUID;

public record CurrentAccountResponse(
    UUID id,
    String email,
    UserRole role,
    boolean verified) {}
