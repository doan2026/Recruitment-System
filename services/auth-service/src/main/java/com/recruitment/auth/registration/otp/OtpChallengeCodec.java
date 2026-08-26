package com.recruitment.auth.registration.otp;

import com.recruitment.auth.identity.IdentityNormalizer;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
public final class OtpChallengeCodec {
  public static final String REGISTRATION_PURPOSE = "registration";

  private static final String VERSION = "v1";
  private static final String HMAC_ALGORITHM = "HmacSHA256";
  private static final byte[] CHALLENGE_DOMAIN =
      "recruitment:otp:challenge:v1".getBytes(StandardCharsets.US_ASCII);
  private static final byte[] EMAIL_KEY_DOMAIN =
      "recruitment:otp:email-key:v1".getBytes(StandardCharsets.US_ASCII);
  private static final int GENERATION_BYTES = 16;
  private static final int DIGEST_BYTES = 32;
  private static final Pattern PURPOSE = Pattern.compile("[a-z][a-z0-9._-]{0,63}");
  private static final Pattern OTP_CODE = Pattern.compile("[0-9]{6}");
  private static final Base64.Encoder BASE64_URL = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder BASE64_URL_DECODER = Base64.getUrlDecoder();

  private final byte[] hmacKey;
  private final SecureRandom random;

  public OtpChallengeCodec(OtpProperties properties, SecureRandom random) {
    this.hmacKey = Objects.requireNonNull(properties, "properties are required").hmacKeyBytes();
    this.random = Objects.requireNonNull(random, "random is required");
  }

  public String encodeRegistration(
      UUID userId, UUID registrationId, String normalizedEmail, String code) {
    return encode(REGISTRATION_PURPOSE, userId, registrationId, normalizedEmail, code);
  }

  public boolean matchesRegistration(
      String storedChallenge,
      UUID userId,
      UUID registrationId,
      String normalizedEmail,
      String presentedCode) {
    return matches(
        storedChallenge,
        REGISTRATION_PURPOSE,
        userId,
        registrationId,
        normalizedEmail,
        presentedCode);
  }

  public String encode(
      String purpose,
      UUID userId,
      UUID registrationId,
      String normalizedEmail,
      String code) {
    String safePurpose = requirePurpose(purpose);
    UUID safeUserId = Objects.requireNonNull(userId, "userId is required");
    UUID safeRegistrationId =
        Objects.requireNonNull(registrationId, "registrationId is required");
    String safeEmail = IdentityNormalizer.normalizeEmail(normalizedEmail);
    String safeCode = requireOtpCode(code);
    byte[] generation = new byte[GENERATION_BYTES];
    random.nextBytes(generation);
    byte[] digest = challengeDigest(
        safePurpose,
        safeUserId,
        safeRegistrationId,
        safeEmail,
        generation,
        safeCode);
    return VERSION + "." + BASE64_URL.encodeToString(generation)
        + "." + BASE64_URL.encodeToString(digest);
  }

  public boolean matches(
      String storedChallenge,
      String purpose,
      UUID userId,
      UUID registrationId,
      String normalizedEmail,
      String presentedCode) {
    ParsedChallenge parsed = parse(storedChallenge);
    if (parsed == null) {
      return false;
    }
    String safePurpose;
    String safeEmail;
    String safeCode;
    try {
      safePurpose = requirePurpose(purpose);
      Objects.requireNonNull(userId, "userId is required");
      Objects.requireNonNull(registrationId, "registrationId is required");
      safeEmail = IdentityNormalizer.normalizeEmail(normalizedEmail);
      safeCode = requireOtpCode(presentedCode);
    } catch (IllegalArgumentException | NullPointerException exception) {
      return false;
    }
    byte[] candidate = challengeDigest(
        safePurpose,
        userId,
        registrationId,
        safeEmail,
        parsed.generation(),
        safeCode);
    return MessageDigest.isEqual(parsed.digest(), candidate);
  }

  public String emailKey(String normalizedEmail) {
    String safeEmail = IdentityNormalizer.normalizeEmail(normalizedEmail);
    byte[] digest = hmac(lengthPrefixed(EMAIL_KEY_DOMAIN, safeEmail));
    return BASE64_URL.encodeToString(digest);
  }

  private byte[] challengeDigest(
      String purpose,
      UUID userId,
      UUID registrationId,
      String normalizedEmail,
      byte[] generation,
      String code) {
    return hmac(challengePayload(
        purpose,
        userId,
        registrationId,
        normalizedEmail,
        generation,
        code));
  }

  private byte[] challengePayload(
      String purpose,
      UUID userId,
      UUID registrationId,
      String normalizedEmail,
      byte[] generation,
      String code) {
    try {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (DataOutputStream output = new DataOutputStream(bytes)) {
        writeField(output, CHALLENGE_DOMAIN);
        writeField(output, purpose.getBytes(StandardCharsets.US_ASCII));
        output.writeLong(userId.getMostSignificantBits());
        output.writeLong(userId.getLeastSignificantBits());
        output.writeLong(registrationId.getMostSignificantBits());
        output.writeLong(registrationId.getLeastSignificantBits());
        writeField(output, normalizedEmail.getBytes(StandardCharsets.UTF_8));
        writeField(output, generation);
        writeField(output, code.getBytes(StandardCharsets.US_ASCII));
      }
      return bytes.toByteArray();
    } catch (IOException impossible) {
      throw new IllegalStateException("could not encode OTP challenge", impossible);
    }
  }

  private static byte[] lengthPrefixed(byte[] domain, String value) {
    try {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (DataOutputStream output = new DataOutputStream(bytes)) {
        writeField(output, domain);
        writeField(output, value.getBytes(StandardCharsets.UTF_8));
      }
      return bytes.toByteArray();
    } catch (IOException impossible) {
      throw new IllegalStateException("could not encode OTP email key", impossible);
    }
  }

  private static void writeField(DataOutputStream output, byte[] value) throws IOException {
    output.writeInt(value.length);
    output.write(value);
  }

  private byte[] hmac(byte[] value) {
    try {
      Mac mac = Mac.getInstance(HMAC_ALGORITHM);
      mac.init(new SecretKeySpec(hmacKey, HMAC_ALGORITHM));
      return mac.doFinal(value);
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("HMAC-SHA256 is unavailable", exception);
    }
  }

  private static ParsedChallenge parse(String storedChallenge) {
    if (storedChallenge == null) {
      return null;
    }
    String[] parts = storedChallenge.split("\\.", -1);
    if (parts.length != 3
        || !VERSION.equals(parts[0])
        || parts[1].length() != 22
        || parts[2].length() != 43) {
      return null;
    }
    try {
      byte[] generation = BASE64_URL_DECODER.decode(parts[1]);
      byte[] digest = BASE64_URL_DECODER.decode(parts[2]);
      if (generation.length != GENERATION_BYTES || digest.length != DIGEST_BYTES) {
        return null;
      }
      return new ParsedChallenge(generation, digest);
    } catch (IllegalArgumentException malformedBase64) {
      return null;
    }
  }

  private static String requirePurpose(String value) {
    if (value == null || !PURPOSE.matcher(value).matches()) {
      throw new IllegalArgumentException("purpose must be a lowercase stable identifier");
    }
    return value;
  }

  private static String requireOtpCode(String value) {
    if (value == null || !OTP_CODE.matcher(value).matches()) {
      throw new IllegalArgumentException("OTP code must contain exactly six ASCII digits");
    }
    return value;
  }

  private record ParsedChallenge(byte[] generation, byte[] digest) {}
}
