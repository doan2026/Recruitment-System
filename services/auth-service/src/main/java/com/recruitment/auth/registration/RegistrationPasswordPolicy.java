package com.recruitment.auth.registration;

import com.recruitment.auth.api.AuthBusinessException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class RegistrationPasswordPolicy {
  private static final int MIN_CODE_POINTS = 8;
  private static final int MAX_BCRYPT_BYTES = 72;

  public void validate(String password) {
    if (password == null) {
      throw violation();
    }
    boolean hasLetter = password.codePoints().anyMatch(Character::isLetter);
    boolean hasDigit = password.codePoints().anyMatch(Character::isDigit);
    int codePoints = password.codePointCount(0, password.length());
    int utf8Bytes = password.getBytes(StandardCharsets.UTF_8).length;
    if (codePoints < MIN_CODE_POINTS
        || utf8Bytes > MAX_BCRYPT_BYTES
        || !hasLetter
        || !hasDigit) {
      throw violation();
    }
  }

  private AuthBusinessException violation() {
    return new AuthBusinessException(
        "PASSWORD_POLICY_VIOLATION",
        "Password must be at least 8 characters, contain a letter and a digit, and fit within 72 UTF-8 bytes",
        HttpStatus.BAD_REQUEST);
  }
}
