package com.recruitment.auth.exception;


public final class LoginAttemptStoreUnavailableException extends RuntimeException {
  public LoginAttemptStoreUnavailableException(Throwable cause) {
    super("login attempt store is unavailable", cause);
  }

  public LoginAttemptStoreUnavailableException(String message) {
    super(message);
  }
}
