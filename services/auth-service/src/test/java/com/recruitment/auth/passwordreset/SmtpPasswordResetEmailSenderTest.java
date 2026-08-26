package com.recruitment.auth.passwordreset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

import com.recruitment.auth.config.AuthMailProperties;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

class SmtpPasswordResetEmailSenderTest {
  @Test
  void sendsTokenOnlyInFragmentLinkBodyForFifteenMinutes() {
    JavaMailSender mail = org.mockito.Mockito.mock(JavaMailSender.class);
    SmtpPasswordResetEmailSender sender = new SmtpPasswordResetEmailSender(
        mail,
        new AuthMailProperties("no-reply@recruitment.local"),
        PasswordResetTestFixtures.properties());
    String rawToken = "pr1_" + "A".repeat(43);

    sender.sendPasswordReset(PasswordResetTestFixtures.EMAIL, rawToken);

    ArgumentCaptor<SimpleMailMessage> message =
        ArgumentCaptor.forClass(SimpleMailMessage.class);
    verify(mail).send(message.capture());
    assertThat(message.getValue().getFrom())
        .isEqualTo("no-reply@recruitment.local");
    assertThat(message.getValue().getTo())
        .containsExactly(PasswordResetTestFixtures.EMAIL);
    assertThat(message.getValue().getSubject()).doesNotContain(rawToken);
    assertThat(message.getValue().getText())
        .contains("15 minutes")
        .contains("#token=" + rawToken)
        .doesNotContain("?token=");
  }
}
