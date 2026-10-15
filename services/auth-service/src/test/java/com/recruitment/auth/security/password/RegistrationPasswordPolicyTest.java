package com.recruitment.auth.security.password;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.recruitment.auth.exception.AuthBusinessException;
import org.junit.jupiter.api.Test;

class RegistrationPasswordPolicyTest {
  private final RegistrationPasswordPolicy policy = new RegistrationPasswordPolicy();

  @Test
  void acceptsPasswordWithAtLeastEightCharactersLetterAndDigit() {
    assertThatCode(() -> policy.validate("candidate1")).doesNotThrowAnyException();
    assertThatCode(() -> policy.validate("MậtKhẩu1")).doesNotThrowAnyException();
  }

  @Test
  void rejectsShortPasswordOrMissingRequiredCharacterClass() {
    assertViolation("abc123");
    assertViolation("abcdefgh");
    assertViolation("12345678");
    assertViolation("");
    assertViolation(null);
  }

  @Test
  void rejectsPasswordBeyondBcryptUtf8Limit() {
    assertViolation("a1" + "é".repeat(36));
    assertThatCode(() -> policy.validate("a1" + "é".repeat(35)))
        .doesNotThrowAnyException();
  }

  @Test
  void doesNotTrimOrNormalizePasswordBeforeValidation() {
    assertThatCode(() -> policy.validate("      a1"))
        .doesNotThrowAnyException();
    assertThatCode(() -> policy.validate("  abcde1"))
        .doesNotThrowAnyException();
  }

  private void assertViolation(String password) {
    assertThatThrownBy(() -> policy.validate(password))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("PASSWORD_POLICY_VIOLATION");
  }
}
