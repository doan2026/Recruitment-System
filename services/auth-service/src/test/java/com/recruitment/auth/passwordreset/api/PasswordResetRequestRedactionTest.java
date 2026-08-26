package com.recruitment.auth.passwordreset.api;

import static org.assertj.core.api.Assertions.assertThat;

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
