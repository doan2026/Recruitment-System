package com.recruitment.auth.accountcontrol.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record UpdateAccountLockRequest(
    @NotNull(message = "locked is required") Boolean locked,
    @Size(max = 500, message = "reason must not exceed 500 characters") String reason) {
  @Override
  public String toString() {
    return "UpdateAccountLockRequest[locked=" + locked + ", reason=[REDACTED]]";
  }
}
