package com.recruitment.admin.dto.moderation;

import jakarta.validation.constraints.*;
import java.util.UUID;

public record VerifyCompanyRequest(
    @NotNull @Pattern(regexp = "APPROVE|REJECT") String decision,
    @Size(max = 1000) String reason
  ) {}
