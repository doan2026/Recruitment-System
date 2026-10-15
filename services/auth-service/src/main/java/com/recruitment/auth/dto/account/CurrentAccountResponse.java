package com.recruitment.auth.dto.account;

import com.recruitment.auth.model.UserRole;
import java.util.UUID;

public record CurrentAccountResponse(
    UUID id,
    String email,
    UserRole role,
    boolean verified) {}
