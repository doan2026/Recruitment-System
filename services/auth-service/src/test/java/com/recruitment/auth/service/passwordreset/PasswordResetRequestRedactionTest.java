package com.recruitment.auth.service.passwordreset;

import static org.assertj.core.api.Assertions.assertThat;
import com.recruitment.auth.dto.passwordreset.ForgotPasswordRequest;
import com.recruitment.auth.dto.passwordreset.ResetPasswordRequest;
import org.junit.jupiter.api.Test;

class PasswordResetRequestRedactionTest {
  @Test
  void requestToStringsNeverExposeEmailTokenOrPassword() {
    String email = "sensitive-candidate@example.com";
    String rawToken = "pr1_" + "A".repeat(43);
    String password = "Sensitive-password1";

    assertThat(new ForgotPasswordRequest(email).toString())
        .contains("<redacted>")
        .doesNotContain(email);
    assertThat(new ResetPasswordRequest(rawToken, password).toString())
        .contains("token=<redacted>")
        .contains("newPassword=<redacted>")
        .doesNotContain(rawToken)
        .doesNotContain(password);
  }
}
