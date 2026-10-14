package com.recruitment.admin.dto.moderation;

import jakarta.validation.constraints.*;
import java.util.UUID;

public record RejectJobRequest(@NotBlank @Size(min = 3, max = 1000) String reason) {}
