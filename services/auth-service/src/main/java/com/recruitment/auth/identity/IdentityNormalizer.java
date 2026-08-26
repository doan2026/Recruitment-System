package com.recruitment.auth.identity;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

public final class IdentityNormalizer {
  private static final int MAX_EMAIL_LENGTH = 320;
  private static final Pattern SIMPLE_EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+$");
  private static final Pattern SHA_256_HEX = Pattern.compile("^[0-9a-f]{64}$");

  private IdentityNormalizer() {}

  public static String normalizeEmail(String value) {
    String normalized = Normalizer.normalize(requireText(value, "email", MAX_EMAIL_LENGTH), Normalizer.Form.NFC)
        .toLowerCase(Locale.ROOT);
    if (normalized.length() > MAX_EMAIL_LENGTH || !SIMPLE_EMAIL.matcher(normalized).matches()) {
      throw new IllegalArgumentException("email must be a valid address");
    }
    return normalized;
  }

  public static String requireSha256Hex(String value) {
    if (value == null || !SHA_256_HEX.matcher(value).matches()) {
      throw new IllegalArgumentException("tokenHash must be a lowercase SHA-256 hex digest");
    }
    return value;
  }

  static String requireText(String value, String field, int maxLength) {
    if (value == null) {
      throw new IllegalArgumentException(field + " is required");
    }
    String normalized = Normalizer.normalize(value.trim(), Normalizer.Form.NFC);
    if (normalized.isEmpty() || normalized.length() > maxLength) {
      throw new IllegalArgumentException(field + " must contain between 1 and " + maxLength + " characters");
    }
    return normalized;
  }
}
