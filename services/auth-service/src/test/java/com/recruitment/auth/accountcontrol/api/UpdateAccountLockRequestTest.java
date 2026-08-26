package com.recruitment.auth.accountcontrol.api;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

class UpdateAccountLockRequestTest {
  private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

  @Test
  void requiresAnExplicitDesiredLockState() {
    UpdateAccountLockRequest request = new UpdateAccountLockRequest(null, "Policy violation");

    assertThat(validator.validate(request))
        .singleElement()
        .satisfies(violation -> {
          assertThat(violation.getPropertyPath().toString()).isEqualTo("locked");
          assertThat(violation.getMessage()).isEqualTo("locked is required");
        });
  }

  @Test
  void rejectsReasonLongerThanThePersistenceContract() {
    UpdateAccountLockRequest request = new UpdateAccountLockRequest(true, "x".repeat(501));

    assertThat(validator.validate(request))
        .singleElement()
        .satisfies(violation -> {
          assertThat(violation.getPropertyPath().toString()).isEqualTo("reason");
          assertThat(violation.getMessage()).contains("500");
        });
  }

  @Test
  void neverRendersTheModerationReasonInDiagnosticText() {
    String sensitiveReason = "private moderation evidence";

    assertThat(new UpdateAccountLockRequest(true, sensitiveReason).toString())
        .contains("locked=true", "[REDACTED]")
        .doesNotContain(sensitiveReason);
  }
}
