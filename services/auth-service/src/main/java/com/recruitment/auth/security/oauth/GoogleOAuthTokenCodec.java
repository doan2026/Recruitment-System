package com.recruitment.auth.security.oauth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public final class GoogleOAuthTokenCodec {
  private static final Base64.Encoder BASE64_URL = Base64.getUrlEncoder().withoutPadding();
  private static final Pattern OPAQUE_TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");
  private static final int TOKEN_BYTES = 32;

  private final SecureRandom random;

  public GoogleOAuthTokenCodec(SecureRandom random) {
    this.random = Objects.requireNonNull(random, "random is required");
  }

  public String generate() {
    byte[] bytes = new byte[TOKEN_BYTES];
    random.nextBytes(bytes);
    return BASE64_URL.encodeToString(bytes);
  }

  public String digest(String value) {
    String token = requireToken(value);
    try {
      return BASE64_URL.encodeToString(
          MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is unavailable", impossible);
    }
  }

  public String requireToken(String value) {
    if (value == null || !OPAQUE_TOKEN.matcher(value).matches()) {
      throw new IllegalArgumentException("OAuth exchange token has an invalid format");
    }
    return value;
  }
}
