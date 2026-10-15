package com.recruitment.auth.security.otp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import java.security.SecureRandom;
import org.junit.jupiter.api.Test;

class SecureOtpCodeGeneratorTest {
  @Test
  void alwaysFormatsTheSecureRandomValueAsSixAsciiDigits() {
    SecureRandom random = mock(SecureRandom.class);
    when(random.nextInt(1_000_000)).thenReturn(0, 7, 999_999);
    SecureOtpCodeGenerator generator = new SecureOtpCodeGenerator(random);

    assertThat(generator.generate()).isEqualTo("000000");
    assertThat(generator.generate()).isEqualTo("000007");
    assertThat(generator.generate()).isEqualTo("999999");
    verify(random, times(3)).nextInt(1_000_000);
  }
}
