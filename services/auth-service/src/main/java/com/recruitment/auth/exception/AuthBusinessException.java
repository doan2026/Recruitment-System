package com.recruitment.auth.exception;

import java.util.Map;
import org.springframework.http.HttpStatus;

public class AuthBusinessException extends RuntimeException {
  private final String code;
  private final HttpStatus status;
  private final Map<String, Object> details;
  private final Long retryAfterSeconds;

  public AuthBusinessException(String code, String message, HttpStatus status) {
    this(code, message, status, Map.of(), null);
  }

  public AuthBusinessException(
      String code,
      String message,
      HttpStatus status,
      Map<String, Object> details) {
    this(code, message, status, details, null);
  }

  public AuthBusinessException(
      String code,
      String message,
      HttpStatus status,
      Map<String, Object> details,
      Long retryAfterSeconds) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details == null ? Map.of() : Map.copyOf(details);
    this.retryAfterSeconds = retryAfterSeconds;
  }

  public String code() {
    return code;
  }

  public HttpStatus status() {
    return status;
  }

  public Map<String, Object> details() {
    return details;
  }

  public Long retryAfterSeconds() {
    return retryAfterSeconds;
  }
}
