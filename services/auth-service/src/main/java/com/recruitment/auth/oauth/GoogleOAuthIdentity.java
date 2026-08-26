package com.recruitment.auth.oauth;

import com.recruitment.auth.identity.IdentityNormalizer;
import java.text.Normalizer;

record GoogleOAuthIdentity(String subject, String normalizedEmail) {
  GoogleOAuthIdentity {
    subject = requireSubject(subject);
    normalizedEmail = requireEmail(normalizedEmail);
  }

  static String requireSubject(String value) {
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

  static String requireEmail(String value) {
    return IdentityNormalizer.normalizeEmail(value);
  }
}
