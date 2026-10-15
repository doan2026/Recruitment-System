package com.recruitment.auth.security.otp;

import java.security.SecureRandom;
import java.util.Locale;
import java.util.Objects;
import org.springframework.stereotype.Component;

@Component
public final class SecureOtpCodeGenerator implements OtpCodeGenerator {
  private static final int OTP_BOUND = 1_000_000;

  private final SecureRandom random;

  public SecureOtpCodeGenerator(SecureRandom random) {
    this.random = Objects.requireNonNull(random, "random is required");
  }

  @Override
  public String generate() {
    return String.format(Locale.ROOT, "%06d", random.nextInt(OTP_BOUND));
  }
}
