package com.recruitment.auth.dto.login;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class LoginRequestTest {
  @Test
  void toStringRedactsPassword() {
    LoginRequest request = new LoginRequest("candidate@example.com", "candidate1");

    assertThat(request.toString())
        .contains("candidate@example.com")
        .contains("password=<redacted>")
        .doesNotContain("candidate1");
  }
}
