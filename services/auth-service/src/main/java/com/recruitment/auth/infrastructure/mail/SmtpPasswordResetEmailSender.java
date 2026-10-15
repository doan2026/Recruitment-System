package com.recruitment.auth.infrastructure.mail;

import com.recruitment.auth.config.properties.AuthMailProperties;
import com.recruitment.auth.config.properties.PasswordResetProperties;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
public class SmtpPasswordResetEmailSender implements PasswordResetEmailSender {
  private final JavaMailSender mailSender;
  private final AuthMailProperties mail;
  private final PasswordResetProperties properties;

  public SmtpPasswordResetEmailSender(
      JavaMailSender mailSender,
      AuthMailProperties mail,
      PasswordResetProperties properties) {
    this.mailSender = mailSender;
    this.mail = mail;
    this.properties = properties;
  }

  @Override
  public void sendPasswordReset(String recipient, String rawToken) {
    SimpleMailMessage message = new SimpleMailMessage();
    message.setFrom(mail.from());
    message.setTo(recipient);
    message.setSubject("Reset your Recruitment System password");
    message.setText(
        "A password reset was requested for your Recruitment System account. "
            + "Use this link within " + properties.ttl().toMinutes() + " minutes:\n"
            + properties.resetLink(rawToken)
            + "\n\nIf you did not request this change, you can ignore this email.");
    mailSender.send(message);
  }
}
