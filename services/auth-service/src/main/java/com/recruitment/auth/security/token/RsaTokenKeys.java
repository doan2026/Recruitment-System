package com.recruitment.auth.security.token;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.recruitment.auth.config.properties.TokenProperties;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;

public final class RsaTokenKeys {
  private static final int MINIMUM_RSA_BITS = 2048;
  private static final byte[] KEY_PAIR_PROBE =
      "recruitment-auth-key-pair-check".getBytes(StandardCharsets.US_ASCII);

  private final RSAPrivateKey activePrivateKey;
  private final RSAKey activePublicJwk;
  private final List<RSAKey> publishedPublicJwks;
  private final Map<String, RSAPublicKey> publicKeysById;

  private RsaTokenKeys(
      RSAPrivateKey activePrivateKey,
      RSAKey activePublicJwk,
      List<RSAKey> publishedPublicJwks) {
    this.activePrivateKey = activePrivateKey;
    this.activePublicJwk = activePublicJwk;
    this.publishedPublicJwks = List.copyOf(publishedPublicJwks);
    LinkedHashMap<String, RSAPublicKey> keys = new LinkedHashMap<>();
    for (RSAKey jwk : publishedPublicJwks) {
      try {
        keys.put(jwk.getKeyID(), jwk.toRSAPublicKey());
      } catch (JOSEException exception) {
        throw new IllegalStateException("Unable to materialize RSA public key", exception);
      }
    }
    this.publicKeysById = Map.copyOf(keys);
  }

  public static RsaTokenKeys load(
      TokenProperties properties, ResourceLoader resources, SecureRandom secureRandom) {
    Objects.requireNonNull(properties, "properties is required").validateNonKeySettings();
    Objects.requireNonNull(resources, "resources is required");
    Objects.requireNonNull(secureRandom, "secureRandom is required");

    String privatePath = trimToNull(properties.getPrivateKeyPath());
    String publicPath = trimToNull(properties.getPublicKeyPath());
    if ((privatePath == null) != (publicPath == null)) {
      throw new IllegalStateException(
          "auth.token.private-key-path and auth.token.public-key-path must be configured together");
    }

    RSAPrivateKey privateKey;
    RSAPublicKey publicKey;
    if (privatePath == null) {
      if (!properties.isAllowEphemeralTestKey()) {
        throw new IllegalStateException(
            "JWT RSA key paths are required; ephemeral keys require "
                + "auth.token.allow-ephemeral-test-key=true explicitly");
      }
      KeyPair generated = generateKeyPair(secureRandom);
      privateKey = (RSAPrivateKey) generated.getPrivate();
      publicKey = (RSAPublicKey) generated.getPublic();
    } else {
      privateKey = readPrivateKey(privatePath, resources);
      publicKey = readPublicKey(publicPath, resources);
    }

    requireStrong(privateKey);
    requireStrong(publicKey);
    requireMatchingPair(privateKey, publicKey, secureRandom);

    RSAKey activeJwk = publicJwk(publicKey);
    LinkedHashMap<String, RSAKey> published = new LinkedHashMap<>();
    published.put(activeJwk.getKeyID(), activeJwk);
    for (String previousPath : properties.getPreviousPublicKeyPaths()) {
      String path = trimToNull(previousPath);
      if (path == null) {
        continue;
      }
      RSAPublicKey previous = readPublicKey(path, resources);
      requireStrong(previous);
      RSAKey previousJwk = publicJwk(previous);
      published.putIfAbsent(previousJwk.getKeyID(), previousJwk);
    }
    return new RsaTokenKeys(privateKey, activeJwk, new ArrayList<>(published.values()));
  }

  public RSAPrivateKey activePrivateKey() {
    return activePrivateKey;
  }

  public String activeKeyId() {
    return activePublicJwk.getKeyID();
  }

  public List<RSAKey> publishedPublicJwks() {
    return publishedPublicJwks;
  }

  public RSAPublicKey publicKey(String keyId) {
    return publicKeysById.get(keyId);
  }

  private static KeyPair generateKeyPair(SecureRandom secureRandom) {
    try {
      KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
      generator.initialize(MINIMUM_RSA_BITS, secureRandom);
      return generator.generateKeyPair();
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Unable to generate ephemeral RSA test key", exception);
    }
  }

  private static RSAPrivateKey readPrivateKey(String location, ResourceLoader resources) {
    byte[] der = decodePem(
        readText(location, resources),
        "-----BEGIN PRIVATE KEY-----",
        "-----END PRIVATE KEY-----",
        location);
    try {
      return (RSAPrivateKey) KeyFactory.getInstance("RSA")
          .generatePrivate(new PKCS8EncodedKeySpec(der));
    } catch (GeneralSecurityException | ClassCastException exception) {
      throw new IllegalStateException(
          "JWT private key must be an unencrypted PKCS#8 RSA private key: " + location,
          exception);
    }
  }

  private static RSAPublicKey readPublicKey(String location, ResourceLoader resources) {
    byte[] der = decodePem(
        readText(location, resources),
        "-----BEGIN PUBLIC KEY-----",
        "-----END PUBLIC KEY-----",
        location);
    try {
      return (RSAPublicKey) KeyFactory.getInstance("RSA")
          .generatePublic(new X509EncodedKeySpec(der));
    } catch (GeneralSecurityException | ClassCastException exception) {
      throw new IllegalStateException(
          "JWT public key must be an X.509 RSA public key: " + location,
          exception);
    }
  }

  private static String readText(String location, ResourceLoader resources) {
    try {
      if (location.startsWith("classpath:") || location.startsWith("file:")) {
        Resource resource = resources.getResource(location);
        try (var input = resource.getInputStream()) {
          return new String(input.readAllBytes(), StandardCharsets.US_ASCII);
        }
      }
      return Files.readString(Path.of(location), StandardCharsets.US_ASCII);
    } catch (IOException | RuntimeException exception) {
      throw new IllegalStateException("Unable to read JWT key: " + location, exception);
    }
  }

  private static byte[] decodePem(
      String pem, String beginMarker, String endMarker, String location) {
    if (!pem.contains(beginMarker) || !pem.contains(endMarker)) {
      throw new IllegalStateException("Unexpected PEM format for JWT key: " + location);
    }
    String body = pem
        .replace(beginMarker, "")
        .replace(endMarker, "")
        .replaceAll("\\s", "");
    try {
      return Base64.getDecoder().decode(body);
    } catch (IllegalArgumentException exception) {
      throw new IllegalStateException("Invalid base64 in JWT key: " + location, exception);
    }
  }

  private static void requireStrong(java.security.interfaces.RSAKey key) {
    if (key.getModulus().bitLength() < MINIMUM_RSA_BITS) {
      throw new IllegalStateException("JWT RSA keys must be at least 2048 bits");
    }
  }

  private static void requireMatchingPair(
      RSAPrivateKey privateKey, RSAPublicKey publicKey, SecureRandom secureRandom) {
    try {
      Signature signature = Signature.getInstance("SHA256withRSA");
      signature.initSign(privateKey, secureRandom);
      signature.update(KEY_PAIR_PROBE);
      byte[] signed = signature.sign();
      signature.initVerify(publicKey);
      signature.update(KEY_PAIR_PROBE);
      if (!signature.verify(signed)) {
        throw new IllegalStateException("JWT private and public keys do not match");
      }
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Unable to validate JWT RSA key pair", exception);
    }
  }

  private static RSAKey publicJwk(RSAPublicKey publicKey) {
    try {
      String keyId = new RSAKey.Builder(publicKey).build().computeThumbprint().toString();
      return new RSAKey.Builder(publicKey)
          .keyUse(KeyUse.SIGNATURE)
          .algorithm(JWSAlgorithm.RS256)
          .keyID(keyId)
          .build();
    } catch (JOSEException exception) {
      throw new IllegalStateException("Unable to compute JWT key identifier", exception);
    }
  }

  private static String trimToNull(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    return value.trim();
  }
}
