package com.recruitment.auth.infrastructure.mail;


public interface OtpEmailSender {
  void sendRegistrationOtp(String recipient, String otp);
}
