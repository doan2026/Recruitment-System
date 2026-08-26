package com.recruitment.auth.passwordreset;

import com.recruitment.auth.identity.IdentityNormalizer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
public final class PasswordResetTokenCodec {
  private static final String HMAC_ALGORITHM = "HmacSHA256";
  private static final int TOKEN_BYTES = 32;
  private static final Pattern RAW_TOKEN =
      Pattern.compile("pr1_[A-Za-z0-9_-]{43}");
  private static final byte[] TOKEN_DOMAIN =
      "recruitment:password-reset:token:v1".getBytes(StandardCharsets.US_ASCII);
  private static final byte[] EMAIL_DOMAIN =
      "recruitment:password-reset:email:v1".getBytes(StandardCharsets.US_ASCII);
  private static final byte[] USER_DOMAIN =
      "recruitment:password-reset:user:v1".getBytes(StandardCharsets.US_ASCII);
  private static final Base64.Encoder BASE64_URL =
      Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder BASE64_URL_DECODER =
      Base64.getUrlDecoder();

  private final byte[] hmacKey;
  private final SecureRandom random;

  public PasswordResetTokenCodec(
      PasswordResetProperties properties,
      SecureRandom random) {
    this.hmacKey = Objects.requireNonNull(properties, "properties are required")
        .hmacKeyBytes();
    this.random = Objects.requireNonNull(random, "random is required");
  }

  public Material issue() {
    byte[] entropy = new byte[TOKEN_BYTES];
    random.nextBytes(entropy);
    String rawToken = "pr1_" + BASE64_URL.encodeToString(entropy);
    return new Material(rawToken, digest(TOKEN_DOMAIN, entropy));
  }

  public Optional<String> digestPresented(String rawToken) {
    if (rawToken == null || !RAW_TOKEN.matcher(rawToken).matches()) {
      return Optional.empty();
    }
    try {
      byte[] entropy = BASE64_URL_DECODER.decode(rawToken.substring(4));
      if (entropy.length != TOKEN_BYTES) {
        return Optional.empty();
      }
      return Optional.of(digest(TOKEN_DOMAIN, entropy));
    } catch (IllegalArgumentException malformedBase64) {
      return Optional.empty();
    }
  }

  public String emailKey(String normalizedEmail) {
    String email = IdentityNormalizer.normalizeEmail(normalizedEmail);
    return BASE64_URL.encodeToString(
        hmac(EMAIL_DOMAIN, email.getBytes(StandardCharsets.UTF_8)));
  }

  public String userKey(UUID userId) {
    UUID safeUserId = Objects.requireNonNull(userId, "userId is required");
    return BASE64_URL.encodeToString(
        hmac(USER_DOMAIN, safeUserId.toString().getBytes(StandardCharsets.US_ASCII)));
  }

  private String digest(byte[] domain, byte[] value) {
    return HexFormat.of().formatHex(hmac(domain, value));
  }

  private byte[] hmac(byte[] domain, byte[] value) {
    try {
      Mac mac = Mac.getInstance(HMAC_ALGORITHM);
      mac.init(new SecretKeySpec(hmacKey, HMAC_ALGORITHM));
      mac.update(domain);
      mac.update((byte) 0);
      return mac.doFinal(value);
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("HMAC-SHA-256 is unavailable", exception);
    }
  }

  public record Material(String rawToken, String tokenDigest) {
    public Material {
      Objects.requireNonNull(rawToken, "rawToken is required");
      Objects.requireNonNull(tokenDigest, "tokenDigest is required");
    }

    @Override
    public String toString() {
      return "Material[rawToken=<redacted>, tokenDigest=<redacted>]";
    }
  }
}
