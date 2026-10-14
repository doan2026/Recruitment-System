package com.recruitment.auth.infrastructure.mail;


public interface PasswordResetEmailSender {
  void sendPasswordReset(String recipient, String rawToken);
}
