package com.recruitment.auth.registration;

import com.recruitment.auth.config.AuthMailProperties;
import com.recruitment.auth.registration.otp.OtpProperties;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
public class SmtpOtpEmailSender implements OtpEmailSender {
  private final JavaMailSender mailSender;
  private final AuthMailProperties mail;
  private final OtpProperties otp;

  public SmtpOtpEmailSender(
      JavaMailSender mailSender,
      AuthMailProperties mail,
      OtpProperties otp) {
    this.mailSender = mailSender;
    this.mail = mail;
    this.otp = otp;
  }

  @Override
  public void sendRegistrationOtp(String recipient, String code) {
    SimpleMailMessage message = new SimpleMailMessage();
    message.setFrom(mail.from());
    message.setTo(recipient);
    message.setSubject("Verify your Recruitment System account");
    message.setText(
        "Your verification code is " + code + ". It expires in "
            + otp.ttl().toMinutes() + " minutes. If you did not request this code, ignore this email.");
    mailSender.send(message);
  }
}
