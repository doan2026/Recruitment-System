package com.recruitment.auth.passwordreset;

public interface PasswordResetEmailSender {
  void sendPasswordReset(String recipient, String rawToken);
}
