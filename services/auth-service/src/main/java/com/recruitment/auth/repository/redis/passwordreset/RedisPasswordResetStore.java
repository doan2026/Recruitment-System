package com.recruitment.auth.repository.redis.passwordreset;

import com.recruitment.auth.config.properties.PasswordResetProperties;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public final class RedisPasswordResetStore {
  private static final String PREFIX =
      "auth:password-reset:v1:{password-reset}:";
  private static final String CHALLENGE_PREFIX = PREFIX + "token:";
  private static final String CLAIM_PREFIX = PREFIX + "claim:";
  private static final String DELIVERY_PREFIX = PREFIX + "delivery:";
  private static final String ACTIVE_PREFIX = PREFIX + "active:";
  private static final String REQUEST_PREFIX = PREFIX + "request:";

  private static final Pattern TOKEN_DIGEST = Pattern.compile("[0-9a-f]{64}");
  private static final Pattern EMAIL_KEY = Pattern.compile("[A-Za-z0-9_-]{43}");
  private static final Pattern OPAQUE_TOKEN = Pattern.compile("[A-Za-z0-9_-]{16,128}");
  private static final Pattern BINDING =
      Pattern.compile("v1[.]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
          + "[0-9a-f]{4}-[0-9a-f]{12})[.]([0-9]+)");

  private static final DefaultRedisScript<Long> REQUEST_SCRIPT = longScript("""
      if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('PTTL', KEYS[1]) < 0 then
        return -1
      end
      local time = redis.call('TIME')
      local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
      local window = tonumber(ARGV[2])
      local maximum = tonumber(ARGV[3])
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
      if redis.call('ZCARD', KEYS[1]) >= maximum then
        return 0
      end
      redis.call('ZADD', KEYS[1], now, ARGV[1])
      redis.call('PEXPIRE', KEYS[1], window)
      return 1
      """);

  private static final DefaultRedisScript<Long> ROLLBACK_REQUEST_SCRIPT = longScript("""
      if redis.call('EXISTS', KEYS[1]) == 0 then
        return 0
      end
      if redis.call('PTTL', KEYS[1]) < 1 then
        return -1
      end
      local removed = redis.call('ZREM', KEYS[1], ARGV[1])
      if removed == 1 and redis.call('ZCARD', KEYS[1]) == 0 then
        redis.call('DEL', KEYS[1])
      end
      return removed
      """);

  private static final DefaultRedisScript<Long> INSTALL_SCRIPT = longScript("""
      local current = redis.call('GET', KEYS[3])
      if current then
        if string.len(current) ~= 64 or not string.match(current, '^[0-9a-f]+$') then
          return -1
        end
        if redis.call('PTTL', KEYS[3]) < 0 then
          return -1
        end
        local oldChallenge = ARGV[4] .. current
        local oldClaim = ARGV[5] .. current
        local oldDelivery = ARGV[6] .. current
        if redis.call('EXISTS', oldClaim) == 1 then
          if redis.call('PTTL', oldClaim) < 0 then
            return -1
          end
          return 2
        end
        if redis.call('EXISTS', oldDelivery) == 1 then
          if redis.call('PTTL', oldDelivery) < 0 then
            return -1
          end
          return 2
        end
        if redis.call('EXISTS', oldChallenge) == 1
            and redis.call('PTTL', oldChallenge) < 0 then
          return -1
        end
        redis.call('DEL', oldChallenge, oldClaim, oldDelivery)
      end
      redis.call('DEL', KEYS[2])
      redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
      redis.call('SET', KEYS[3], ARGV[1], 'PX', ARGV[3])
      return 1
      """);

  private static final DefaultRedisScript<String> CLAIM_SCRIPT = stringScript("""
      local binding = redis.call('GET', KEYS[1])
      if not binding then
        return 'MISSING||0'
      end
      local tokenTtl = redis.call('PTTL', KEYS[1])
      if tokenTtl < 1 then
        return 'CORRUPT||0'
      end
      local activeDelivery = redis.call('GET', KEYS[3])
      if activeDelivery then
        local deliveryTtl = redis.call('PTTL', KEYS[3])
        if deliveryTtl < 1 then
          return 'CORRUPT||0'
        end
        return 'IN_PROGRESS||' .. deliveryTtl
      end
      local currentClaim = redis.call('GET', KEYS[2])
      if currentClaim then
        local claimTtl = redis.call('PTTL', KEYS[2])
        if claimTtl < 1 then
          return 'CORRUPT||0'
        end
        if currentClaim == ARGV[1] then
          return 'CLAIMED|' .. binding .. '|' .. claimTtl
        end
        return 'IN_PROGRESS||' .. claimTtl
      end
      local claimTtl = math.min(tokenTtl, tonumber(ARGV[2]))
      if claimTtl < 1 then
        return 'CORRUPT||0'
      end
      redis.call('SET', KEYS[2], ARGV[1], 'PX', claimTtl)
      return 'CLAIMED|' .. binding .. '|' .. claimTtl
      """);

  private static final DefaultRedisScript<Long> FINALIZE_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      if redis.call('GET', KEYS[2]) ~= ARGV[2] then
        return 0
      end
      redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
      if redis.call('GET', KEYS[4]) == ARGV[3] then
        redis.call('DEL', KEYS[4])
      end
      return 1
      """);

  private static final DefaultRedisScript<Long> RECOVER_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      if redis.call('GET', KEYS[2]) ~= ARGV[2] then
        return 0
      end
      return redis.call('DEL', KEYS[2])
      """);

  private static final DefaultRedisScript<Long> DISCARD_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      if redis.call('EXISTS', KEYS[2]) == 1
          or redis.call('EXISTS', KEYS[3]) == 1 then
        return 2
      end
      redis.call('DEL', KEYS[1])
      if redis.call('GET', KEYS[4]) == ARGV[2] then
        redis.call('DEL', KEYS[4])
      end
      return 1
      """);

  private static final DefaultRedisScript<Long> ACQUIRE_DELIVERY_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      if redis.call('PTTL', KEYS[1]) < 1 then
        return -1
      end
      if redis.call('GET', KEYS[2]) ~= ARGV[2] then
        return 0
      end
      if redis.call('PTTL', KEYS[2]) < 1 then
        return -1
      end
      local current = redis.call('GET', KEYS[3])
      if current then
        if redis.call('PTTL', KEYS[3]) < 1 then
          return -1
        end
        if current == ARGV[3] then
          redis.call('PEXPIRE', KEYS[3], ARGV[4])
          return 1
        end
        return 2
      end
      redis.call('SET', KEYS[3], ARGV[3], 'PX', ARGV[4])
      return 1
      """);

  private static final DefaultRedisScript<Long> RELEASE_DELIVERY_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      return redis.call('DEL', KEYS[1])
      """);

  private final StringRedisTemplate redis;
  private final PasswordResetProperties properties;

  public RedisPasswordResetStore(
      StringRedisTemplate redis,
      PasswordResetProperties properties) {
    this.redis = Objects.requireNonNull(redis, "redis is required");
    this.properties = Objects.requireNonNull(properties, "properties are required");
  }

  public boolean reserveRequest(String emailKey, String requestToken) {
    Long result = redis.execute(
        REQUEST_SCRIPT,
        List.of(requestKey(emailKey)),
        requireOpaqueToken(requestToken, "requestToken"),
        Long.toString(properties.requestWindowMillis()),
        Integer.toString(properties.maxRequests()));
    long status = requireResult(result, "reserve password-reset request");
    if (status == -1L) {
      throw new IllegalStateException("password-reset request quota is corrupt");
    }
    if (status == 0L || status == 1L) {
      return status == 1L;
    }
    throw new IllegalStateException("unexpected password-reset request result: " + status);
  }

  public boolean rollbackRequest(String emailKey, String requestToken) {
    Long result = redis.execute(
        ROLLBACK_REQUEST_SCRIPT,
        List.of(requestKey(emailKey)),
        requireOpaqueToken(requestToken, "requestToken"));
    long status = requireResult(result, "roll back password-reset request quota");
    if (status == -1L) {
      throw new IllegalStateException("password-reset request quota is corrupt");
    }
    if (status == 0L || status == 1L) {
      return status == 1L;
    }
    throw new IllegalStateException(
        "unexpected password-reset request rollback result: " + status);
  }

  public InstallStatus install(
      String tokenDigest,
      String userKey,
      Binding binding) {
    String digest = requireDigest(tokenDigest);
    Binding safeBinding = Objects.requireNonNull(binding, "binding is required");
    Long result = redis.execute(
        INSTALL_SCRIPT,
        List.of(
            challengeKey(digest),
            claimKey(digest),
            activeKey(userKey)),
        digest,
        safeBinding.serialize(),
        Long.toString(properties.ttlMillis()),
        CHALLENGE_PREFIX,
        CLAIM_PREFIX,
        DELIVERY_PREFIX);
    long status = requireResult(result, "install password-reset challenge");
    if (status == -1L) {
      throw new IllegalStateException("password-reset active state is corrupt");
    }
    if (status == 1L) {
      return InstallStatus.INSTALLED;
    }
    if (status == 2L) {
      return InstallStatus.CLAIM_IN_PROGRESS;
    }
    throw new IllegalStateException("unexpected password-reset install result: " + status);
  }

  public ClaimResult claim(String tokenDigest, String claimToken) {
    String digest = requireDigest(tokenDigest);
    String result = redis.execute(
        CLAIM_SCRIPT,
        List.of(challengeKey(digest), claimKey(digest), deliveryKey(digest)),
        requireOpaqueToken(claimToken, "claimToken"),
        Long.toString(properties.claimTtlMillis()));
    return parseClaimResult(requireResult(result, "claim password-reset challenge"));
  }

  public boolean finalizeClaim(
      String tokenDigest,
      String userKey,
      Binding binding,
      String claimToken) {
    String digest = requireDigest(tokenDigest);
    Binding safeBinding = Objects.requireNonNull(binding, "binding is required");
    Long result = redis.execute(
        FINALIZE_SCRIPT,
        List.of(
            challengeKey(digest),
            claimKey(digest),
            deliveryKey(digest),
            activeKey(userKey)),
        safeBinding.serialize(),
        requireOpaqueToken(claimToken, "claimToken"),
        digest);
    return requireResult(result, "finalize password-reset claim") == 1L;
  }

  public boolean recoverClaim(
      String tokenDigest,
      Binding binding,
      String claimToken) {
    String digest = requireDigest(tokenDigest);
    Binding safeBinding = Objects.requireNonNull(binding, "binding is required");
    Long result = redis.execute(
        RECOVER_SCRIPT,
        List.of(challengeKey(digest), claimKey(digest)),
        safeBinding.serialize(),
        requireOpaqueToken(claimToken, "claimToken"));
    return requireResult(result, "recover password-reset claim") == 1L;
  }

  public boolean discardUnclaimed(
      String tokenDigest,
      String userKey,
      Binding binding) {
    String digest = requireDigest(tokenDigest);
    Binding safeBinding = Objects.requireNonNull(binding, "binding is required");
    Long result = redis.execute(
        DISCARD_SCRIPT,
        List.of(
            challengeKey(digest),
            claimKey(digest),
            deliveryKey(digest),
            activeKey(userKey)),
        safeBinding.serialize(),
        digest);
    long status = requireResult(result, "discard password-reset challenge");
    if (status == 0L || status == 1L || status == 2L) {
      return status == 1L;
    }
    throw new IllegalStateException("unexpected password-reset discard result: " + status);
  }

  public boolean acquireDelivery(
      String tokenDigest,
      String userKey,
      Binding binding,
      String deliveryToken) {
    String digest = requireDigest(tokenDigest);
    Binding safeBinding = Objects.requireNonNull(binding, "binding is required");
    Long result = redis.execute(
        ACQUIRE_DELIVERY_SCRIPT,
        List.of(
            challengeKey(digest),
            activeKey(userKey),
            deliveryKey(digest)),
        safeBinding.serialize(),
        digest,
        requireOpaqueToken(deliveryToken, "deliveryToken"),
        Long.toString(properties.claimTtlMillis()));
    long status = requireResult(result, "acquire password-reset delivery");
    if (status == -1L) {
      throw new IllegalStateException("password-reset delivery state is corrupt");
    }
    if (status == 0L || status == 1L || status == 2L) {
      return status == 1L;
    }
    throw new IllegalStateException("unexpected password-reset delivery result: " + status);
  }

  public boolean releaseDelivery(String tokenDigest, String deliveryToken) {
    String digest = requireDigest(tokenDigest);
    Long result = redis.execute(
        RELEASE_DELIVERY_SCRIPT,
        List.of(deliveryKey(digest)),
        requireOpaqueToken(deliveryToken, "deliveryToken"));
    return requireResult(result, "release password-reset delivery") == 1L;
  }

  String requestKey(String emailKey) {
    if (emailKey == null || !EMAIL_KEY.matcher(emailKey).matches()) {
      throw new IllegalArgumentException("emailKey has an invalid shape");
    }
    return REQUEST_PREFIX + emailKey;
  }

  String challengeKey(String tokenDigest) {
    return CHALLENGE_PREFIX + requireDigest(tokenDigest);
  }

  String claimKey(String tokenDigest) {
    return CLAIM_PREFIX + requireDigest(tokenDigest);
  }

  String deliveryKey(String tokenDigest) {
    return DELIVERY_PREFIX + requireDigest(tokenDigest);
  }

  String activeKey(String userKey) {
    if (userKey == null || !EMAIL_KEY.matcher(userKey).matches()) {
      throw new IllegalArgumentException("userKey has an invalid shape");
    }
    return ACTIVE_PREFIX + userKey;
  }

  static ClaimResult parseClaimResult(String value) {
    if (value == null) {
      throw new IllegalStateException("password-reset claim returned no result");
    }
    String[] fields = value.split("[|]", -1);
    if (fields.length != 3 || "CORRUPT".equals(fields[0])) {
      throw new IllegalStateException("password-reset claim state is corrupt");
    }
    try {
      ClaimStatus status = ClaimStatus.valueOf(fields[0]);
      long retryMillis = Long.parseLong(fields[2]);
      if (retryMillis < 0) {
        throw new IllegalStateException("password-reset claim returned a negative TTL");
      }
      return switch (status) {
        case CLAIMED -> new ClaimResult(
            status,
            Binding.parse(fields[1]),
            requirePositiveDuration(retryMillis));
        case IN_PROGRESS -> {
          if (!fields[1].isEmpty()) {
            throw new IllegalStateException(
                "in-progress password-reset claim exposed a binding");
          }
          yield new ClaimResult(status, null, requirePositiveDuration(retryMillis));
        }
        case MISSING -> {
          if (!fields[1].isEmpty() || retryMillis != 0) {
            throw new IllegalStateException(
                "missing password-reset claim returned incoherent data");
          }
          yield new ClaimResult(status, null, Duration.ZERO);
        }
      };
    } catch (IllegalArgumentException exception) {
      throw new IllegalStateException(
          "unexpected password-reset claim result", exception);
    }
  }

  private static Duration requirePositiveDuration(long milliseconds) {
    if (milliseconds < 1) {
      throw new IllegalStateException(
          "password-reset claim requires a positive TTL");
    }
    return Duration.ofMillis(milliseconds);
  }

  private static String requireDigest(String value) {
    if (value == null || !TOKEN_DIGEST.matcher(value).matches()) {
      throw new IllegalArgumentException("tokenDigest has an invalid shape");
    }
    return value;
  }

  private static String requireOpaqueToken(String value, String field) {
    if (value == null || !OPAQUE_TOKEN.matcher(value).matches()) {
      throw new IllegalArgumentException(field + " has an invalid shape");
    }
    return value;
  }

  private static long requireResult(Long value, String operation) {
    if (value == null) {
      throw new IllegalStateException(operation + " returned no result");
    }
    return value;
  }

  private static String requireResult(String value, String operation) {
    if (value == null) {
      throw new IllegalStateException(operation + " returned no result");
    }
    return value;
  }

  private static DefaultRedisScript<Long> longScript(String source) {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>();
    script.setScriptText(source);
    script.setResultType(Long.class);
    return script;
  }

  private static DefaultRedisScript<String> stringScript(String source) {
    DefaultRedisScript<String> script = new DefaultRedisScript<>();
    script.setScriptText(source);
    script.setResultType(String.class);
    return script;
  }

  public enum InstallStatus {
    INSTALLED,
    CLAIM_IN_PROGRESS
  }

  public enum ClaimStatus {
    CLAIMED,
    IN_PROGRESS,
    MISSING
  }

  public record Binding(UUID userId, long userVersion) {
    public Binding {
      Objects.requireNonNull(userId, "userId is required");
      if (userVersion < 0) {
        throw new IllegalArgumentException("userVersion cannot be negative");
      }
    }

    String serialize() {
      return "v1." + userId + "." + userVersion;
    }

    static Binding parse(String value) {
      if (value == null) {
        throw new IllegalArgumentException("binding is required");
      }
      var matcher = BINDING.matcher(value);
      if (!matcher.matches()) {
        throw new IllegalArgumentException("binding has an invalid shape");
      }
      UUID userId = UUID.fromString(matcher.group(1));
      if (!userId.toString().equals(matcher.group(1))) {
        throw new IllegalArgumentException("binding userId is not canonical");
      }
      long version = Long.parseLong(matcher.group(2));
      return new Binding(userId, version);
    }
  }

  public record ClaimResult(
      ClaimStatus status,
      Binding binding,
      Duration retryAfter) {
    public ClaimResult {
      Objects.requireNonNull(status, "status is required");
      Objects.requireNonNull(retryAfter, "retryAfter is required");
      if ((status == ClaimStatus.CLAIMED) != (binding != null)) {
        throw new IllegalArgumentException(
            "only a claimed password-reset token may expose a binding");
      }
    }
  }
}
