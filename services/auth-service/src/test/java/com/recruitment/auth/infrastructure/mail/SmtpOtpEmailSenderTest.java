package com.recruitment.auth.infrastructure.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import com.recruitment.auth.config.properties.AuthMailProperties;
import com.recruitment.auth.config.properties.OtpProperties;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

class SmtpOtpEmailSenderTest {
  @Test
  void sendsOnlyTheRegistrationCodeToTheCanonicalRecipient() {
    JavaMailSender mailSender = org.mockito.Mockito.mock(JavaMailSender.class);
    SmtpOtpEmailSender sender = new SmtpOtpEmailSender(
        mailSender,
        new AuthMailProperties("no-reply@recruitment.local"),
        properties());

    sender.sendRegistrationOtp("candidate@example.com", "001234");

    ArgumentCaptor<SimpleMailMessage> message =
        ArgumentCaptor.forClass(SimpleMailMessage.class);
    verify(mailSender).send(message.capture());
    assertThat(message.getValue().getFrom()).isEqualTo("no-reply@recruitment.local");
    assertThat(message.getValue().getTo()).containsExactly("candidate@example.com");
    assertThat(message.getValue().getSubject()).doesNotContain("001234");
    assertThat(message.getValue().getText())
        .contains("001234")
        .contains("5 minutes")
        .doesNotContain("password");
  }

  private static OtpProperties properties() {
    return new OtpProperties(
        "test-hmac-secret-that-is-at-least-32-bytes",
        Duration.ofMinutes(5),
        Duration.ofMinutes(15),
        5,
        Duration.ofHours(1),
        3,
        Duration.ofSeconds(30),
        Duration.ofSeconds(15));
  }
}
