package com.recruitment.auth.model.oauth;

import com.recruitment.auth.support.IdentityNormalizer;
import java.text.Normalizer;

public record GoogleOAuthIdentity(String subject, String normalizedEmail) {
  public GoogleOAuthIdentity {
    subject = requireSubject(subject);
    normalizedEmail = requireEmail(normalizedEmail);
  }

  public static String requireSubject(String value) {
    if (value == null) {
      throw new IllegalArgumentException("Google subject is required");
    }
    String normalized = Normalizer.normalize(value.trim(), Normalizer.Form.NFC);
    if (normalized.isEmpty() || normalized.length() > 255) {
      throw new IllegalArgumentException(
          "Google subject must contain between 1 and 255 characters");
    }
    return normalized;
  }

  public static String requireEmail(String value) {
    return IdentityNormalizer.normalizeEmail(value);
  }
}
