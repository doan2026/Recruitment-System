package com.recruitment.auth.security.token;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class RefreshTokenCodec {
  private static final int TOKEN_BYTES = 32;
  private static final String PREFIX = "rt1_";
  private static final Pattern TOKEN_FORMAT =
      Pattern.compile("^rt1_[A-Za-z0-9_-]{43}$");

  private final SecureRandom secureRandom;

  public RefreshTokenCodec() {
    this(new SecureRandom());
  }

  public RefreshTokenCodec(SecureRandom secureRandom) {
    this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom is required");
  }

  public Material issue() {
    byte[] bytes = new byte[TOKEN_BYTES];
    secureRandom.nextBytes(bytes);
    String raw = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    return new Material(raw, sha256(raw));
  }

  public Optional<String> hashPresented(String rawToken) {
    if (rawToken == null || !TOKEN_FORMAT.matcher(rawToken).matches()) {
      return Optional.empty();
    }
    return Optional.of(sha256(rawToken));
  }

  private static String sha256(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256")
          .digest(value.getBytes(StandardCharsets.US_ASCII));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is unavailable", exception);
    }
  }

  public record Material(String rawToken, String tokenHash) {
    public Material {
      Objects.requireNonNull(rawToken, "rawToken is required");
      Objects.requireNonNull(tokenHash, "tokenHash is required");
    }

    @Override
    public String toString() {
      return "Material[rawToken=<redacted>, tokenHash=<redacted>]";
    }
  }
}
