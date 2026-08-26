package com.recruitment.auth.passwordreset;

final class PasswordResetRejectedException extends RuntimeException {
  PasswordResetRejectedException() {
    super("password-reset binding no longer matches the account");
  }
}
