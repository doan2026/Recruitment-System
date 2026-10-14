package com.recruitment.auth.exception;


public final class PasswordResetRejectedException extends RuntimeException {
  public PasswordResetRejectedException() {
    super("password-reset binding no longer matches the account");
  }
}
