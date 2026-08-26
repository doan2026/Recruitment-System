package com.recruitment.auth.login;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public final class RedisLoginAttemptLimiter implements LoginAttemptLimiter {
  private static final String HMAC_ALGORITHM = "HmacSHA256";
  private static final Pattern EMAIL_KEY = Pattern.compile("[A-Za-z0-9_-]{43}");

  private static final DefaultRedisScript<String> PREFLIGHT_SCRIPT = script("""
      local block = redis.call('GET', KEYS[2])
      if block then
        local ttl = redis.call('PTTL', KEYS[2])
        if block ~= '1' or ttl < 0 then
          return 'CORRUPT|0|0'
        end
        return 'BLOCKED|' .. ARGV[1] .. '|' .. math.max(1, ttl)
      end

      local failure = redis.call('GET', KEYS[1])
      if not failure then
        return 'ALLOWED|0|0'
      end
      local ttl = redis.call('PTTL', KEYS[1])
      if not string.match(failure, '^%d+$') or ttl < 0 then
        return 'CORRUPT|0|0'
      end
      local attempts = tonumber(failure)
      if attempts < 1 or attempts >= tonumber(ARGV[1]) then
        return 'CORRUPT|0|0'
      end
      return 'ALLOWED|' .. attempts .. '|0'
      """);

  private static final DefaultRedisScript<String> FAILURE_SCRIPT = script("""
      local block = redis.call('GET', KEYS[2])
      if block then
        local ttl = redis.call('PTTL', KEYS[2])
        if block ~= '1' or ttl < 0 then
          return 'CORRUPT|0|0'
        end
        return 'BLOCKED|' .. ARGV[1] .. '|' .. math.max(1, ttl)
      end

      local failure = redis.call('GET', KEYS[1])
      if failure then
        local ttl = redis.call('PTTL', KEYS[1])
        if not string.match(failure, '^%d+$') or ttl < 0 then
          return 'CORRUPT|0|0'
        end
        local existing = tonumber(failure)
        if existing < 1 or existing >= tonumber(ARGV[1]) then
          return 'CORRUPT|0|0'
        end
      end

      local attempts = redis.call('INCR', KEYS[1])
      if attempts >= tonumber(ARGV[1]) then
        redis.call('DEL', KEYS[1])
        redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
        return 'BLOCKED|' .. attempts .. '|' .. ARGV[3]
      end
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
      return 'FAILED|' .. attempts .. '|0'
      """);

  private static final DefaultRedisScript<String> SUCCESS_SCRIPT = script("""
      local block = redis.call('GET', KEYS[2])
      if block then
        local ttl = redis.call('PTTL', KEYS[2])
        if block ~= '1' or ttl < 0 then
          return 'CORRUPT|0|0'
        end
        return 'BLOCKED|' .. ARGV[1] .. '|' .. math.max(1, ttl)
      end

      local failure = redis.call('GET', KEYS[1])
      local attempts = 0
      if failure then
        local ttl = redis.call('PTTL', KEYS[1])
        if not string.match(failure, '^%d+$') or ttl < 0 then
          return 'CORRUPT|0|0'
        end
        attempts = tonumber(failure)
        if attempts < 1 or attempts >= tonumber(ARGV[1]) then
          return 'CORRUPT|0|0'
        end
      end
      redis.call('DEL', KEYS[1])
      return 'ALLOWED|' .. attempts .. '|0'
      """);

  private final StringRedisTemplate redis;
  private final LoginProperties properties;
  private final byte[] hmacKey;

  public RedisLoginAttemptLimiter(StringRedisTemplate redis, LoginProperties properties) {
    this.redis = Objects.requireNonNull(redis, "redis is required");
    this.properties = Objects.requireNonNull(properties, "properties are required");
    this.hmacKey = properties.hmacKeyBytes();
  }

  @Override
  public AttemptDecision preflight(String normalizedEmail) {
    return execute(PREFLIGHT_SCRIPT, normalizedEmail, properties.maxFailedAttempts());
  }

  @Override
  public AttemptDecision recordFailure(String normalizedEmail) {
    return execute(
        FAILURE_SCRIPT,
        normalizedEmail,
        properties.maxFailedAttempts(),
        properties.failureWindowMillis(),
        properties.failureBlockMillis());
  }

  @Override
  public AttemptDecision completeSuccessfulCredential(String normalizedEmail) {
    return execute(SUCCESS_SCRIPT, normalizedEmail, properties.maxFailedAttempts());
  }

  private AttemptDecision execute(
      DefaultRedisScript<String> redisScript,
      String normalizedEmail,
      Object... arguments) {
    try {
      List<String> keys = keys(normalizedEmail);
      Object[] serializedArguments = new Object[arguments.length];
      for (int index = 0; index < arguments.length; index++) {
        serializedArguments[index] = String.valueOf(arguments[index]);
      }
      String result = redis.execute(redisScript, keys, serializedArguments);
      return parseDecision(result, properties.maxFailedAttempts());
    } catch (DataAccessException exception) {
      throw new LoginAttemptStoreUnavailableException(exception);
    } catch (IllegalStateException exception) {
      throw new LoginAttemptStoreUnavailableException(exception);
    }
  }

  List<String> keys(String normalizedEmail) {
    String emailKey = emailKey(normalizedEmail);
    String prefix = "auth:login:v1:{" + emailKey + "}:";
    return List.of(prefix + "fail", prefix + "block");
  }

  String emailKey(String normalizedEmail) {
    if (normalizedEmail == null || normalizedEmail.isBlank()) {
      throw new IllegalArgumentException("normalizedEmail is required");
    }
    try {
      Mac mac = Mac.getInstance(HMAC_ALGORITHM);
      mac.init(new SecretKeySpec(hmacKey, HMAC_ALGORITHM));
      String result = Base64.getUrlEncoder().withoutPadding().encodeToString(
          mac.doFinal(normalizedEmail.getBytes(StandardCharsets.UTF_8)));
      if (!EMAIL_KEY.matcher(result).matches()) {
        throw new IllegalStateException("login email key has an invalid shape");
      }
      return result;
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("HMAC-SHA-256 is unavailable", exception);
    }
  }

  static AttemptDecision parseDecision(String value, int maximumAttempts) {
    if (value == null) {
      throw new IllegalStateException("login attempt store returned no result");
    }
    String[] fields = value.split("[|]", -1);
    if (fields.length != 3) {
      throw new IllegalStateException("login attempt store returned an invalid result");
    }
    try {
      int attempts = Integer.parseInt(fields[1]);
      long retryMillis = Long.parseLong(fields[2]);
      if (attempts < 0 || retryMillis < 0) {
        throw new IllegalStateException("login attempt store returned negative values");
      }
      return switch (fields[0]) {
        case "ALLOWED" -> {
          if (attempts >= maximumAttempts || retryMillis != 0) {
            throw new IllegalStateException("allowed login state is incoherent");
          }
          yield AttemptDecision.allowed(attempts);
        }
        case "FAILED" -> {
          if (attempts < 1 || attempts >= maximumAttempts || retryMillis != 0) {
            throw new IllegalStateException("failed login state is incoherent");
          }
          yield AttemptDecision.failed(attempts);
        }
        case "BLOCKED" -> {
          if (attempts < maximumAttempts || retryMillis < 1) {
            throw new IllegalStateException("blocked login state is incoherent");
          }
          yield AttemptDecision.blocked(attempts, Duration.ofMillis(retryMillis));
        }
        default -> throw new IllegalStateException(
            "login attempt store returned an unknown state");
      };
    } catch (NumberFormatException | ArithmeticException exception) {
      throw new IllegalStateException("login attempt store returned invalid numbers", exception);
    }
  }

  private static DefaultRedisScript<String> script(String source) {
    DefaultRedisScript<String> script = new DefaultRedisScript<>();
    script.setScriptText(source);
    script.setResultType(String.class);
    return script;
  }
}
