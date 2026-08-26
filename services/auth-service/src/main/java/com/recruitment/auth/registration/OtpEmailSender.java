package com.recruitment.auth.registration;

public interface OtpEmailSender {
  void sendRegistrationOtp(String recipient, String otp);
}
