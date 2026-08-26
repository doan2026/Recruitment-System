package com.recruitment.auth.login;

final class LoginAttemptStoreUnavailableException extends RuntimeException {
  LoginAttemptStoreUnavailableException(Throwable cause) {
    super("login attempt store is unavailable", cause);
  }

  LoginAttemptStoreUnavailableException(String message) {
    super(message);
  }
}
