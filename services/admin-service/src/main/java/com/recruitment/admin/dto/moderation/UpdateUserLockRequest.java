package com.recruitment.admin.dto.moderation;

import jakarta.validation.constraints.*;
import java.util.UUID;

public record UpdateUserLockRequest(@NotNull Boolean locked, @Size(max = 500) String reason) {}
