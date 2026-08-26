package com.recruitment.auth.login;

public final class LoginAttemptStoreUnavailableException extends RuntimeException {
  public LoginAttemptStoreUnavailableException(Throwable cause) {
    super("login attempt store is unavailable", cause);
  }

  public LoginAttemptStoreUnavailableException(String message) {
    super(message);
  }
}
