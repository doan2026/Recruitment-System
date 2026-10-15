package com.recruitment.auth.repository.redis.oauth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.auth.config.properties.GoogleOAuthProperties;
import com.recruitment.auth.dto.oauth.GoogleOAuthRole;
import com.recruitment.auth.model.oauth.GoogleOAuthIdentity;
import com.recruitment.auth.security.oauth.GoogleOAuthTokenCodec;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public final class GoogleOAuthExchangeStore {
  private static final String KEY_PREFIX = "auth:google:exchange:v1:";
  private static final int MAX_INSTALL_ATTEMPTS = 4;
  private static final String BINDER_MISMATCH = "BINDER_MISMATCH";

  private static final DefaultRedisScript<String> CONSUME_SCRIPT =
      new DefaultRedisScript<>("""
          local value = redis.call('GET', KEYS[1])
          if not value then
            return nil
          end
          local ok, decoded = pcall(cjson.decode, value)
          if not ok then
            redis.call('DEL', KEYS[1])
            return nil
          end
          if decoded.binderDigest ~= ARGV[1] then
            return 'BINDER_MISMATCH'
          end
          redis.call('DEL', KEYS[1])
          return value
          """, String.class);

  private final StringRedisTemplate redis;
  private final ObjectMapper objectMapper;
  private final GoogleOAuthTokenCodec tokenCodec;
  private final GoogleOAuthProperties properties;

  public GoogleOAuthExchangeStore(
      StringRedisTemplate redis,
      ObjectMapper objectMapper,
      GoogleOAuthTokenCodec tokenCodec,
      GoogleOAuthProperties properties) {
    this.redis = Objects.requireNonNull(redis, "redis is required");
    this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper is required");
    this.tokenCodec = Objects.requireNonNull(tokenCodec, "tokenCodec is required");
    this.properties = Objects.requireNonNull(properties, "properties are required");
  }

  public PendingExchange create(String subject, String normalizedEmail) {
    return create(subject, normalizedEmail, null);
  }

  public PendingExchange create(String subject, String normalizedEmail, GoogleOAuthRole role) {
    String safeSubject = GoogleOAuthIdentity.requireSubject(subject);
    String safeEmail = GoogleOAuthIdentity.requireEmail(normalizedEmail);
    Duration ttl = properties.exchangeTtl();
    for (int attempt = 0; attempt < MAX_INSTALL_ATTEMPTS; attempt++) {
      String code = tokenCodec.generate();
      String binder = tokenCodec.generate();
      StoredExchange value = new StoredExchange(
          tokenCodec.digest(binder), safeSubject, safeEmail, role);
      Boolean installed = redis.opsForValue().setIfAbsent(
          key(code), serialize(value), ttl);
      if (Boolean.TRUE.equals(installed)) {
        return new PendingExchange(code, binder, ttl);
      }
    }
    throw new IllegalStateException("could not reserve a Google exchange code");
  }

  public Optional<VerifiedExchange> consume(String code, String binder) {
    final String codeKey;
    final String binderDigest;
    try {
      codeKey = key(code);
      binderDigest = tokenCodec.digest(binder);
    } catch (IllegalArgumentException malformed) {
      return Optional.empty();
    }
    String result = redis.execute(CONSUME_SCRIPT, List.of(codeKey), binderDigest);
    if (result == null || BINDER_MISMATCH.equals(result)) {
      return Optional.empty();
    }
    StoredExchange stored = deserialize(result);
    if (stored == null) {
      return Optional.empty();
    }
    return Optional.of(new VerifiedExchange(
        new GoogleOAuthIdentity(stored.subject(), stored.normalizedEmail()), stored.role()));
  }

  private String key(String code) {
    return KEY_PREFIX + tokenCodec.digest(code);
  }

  private String serialize(StoredExchange value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("could not serialize Google exchange state", exception);
    }
  }

  private StoredExchange deserialize(String value) {
    try {
      return objectMapper.readValue(value, StoredExchange.class);
    } catch (JsonProcessingException | IllegalArgumentException exception) {
      return null;
    }
  }

  public record PendingExchange(String code, String binder, Duration ttl) {
    @Override
    public String toString() {
      return "PendingExchange[code=<redacted>, binder=<redacted>, ttl=" + ttl + "]";
    }
  }

  private record StoredExchange(
      String binderDigest,
      String subject,
      String normalizedEmail,
      GoogleOAuthRole role) {}

  public record VerifiedExchange(GoogleOAuthIdentity identity, GoogleOAuthRole role) {
    @Override
    public String toString() {
      return "VerifiedExchange[identity=<redacted>, role=" + role + "]";
    }
  }
}
