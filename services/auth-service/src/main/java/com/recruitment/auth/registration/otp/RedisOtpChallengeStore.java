package com.recruitment.auth.registration.otp;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public final class RedisOtpChallengeStore {
  private static final Pattern EMAIL_KEY = Pattern.compile("[A-Za-z0-9_-]{43}");
  private static final Pattern STORED_CHALLENGE = Pattern.compile(
      "v1\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}");
  private static final Pattern OPAQUE_TOKEN = Pattern.compile("[A-Za-z0-9_-]{16,128}");

  private static final DefaultRedisScript<Long> INSTALL_SCRIPT = longScript("""
      local failure = redis.call('GET', KEYS[3])
      if redis.call('GET', KEYS[4]) ~= ARGV[4] then
        return 3
      end
      if redis.call('PTTL', KEYS[4]) < 0 then
        return -1
      end
      if failure then
        if not string.match(failure, '^%d+$') or redis.call('PTTL', KEYS[3]) < 0 then
          return -1
        end
      end
      if failure and tonumber(failure) >= tonumber(ARGV[3]) then
        return 0
      end
      if redis.call('EXISTS', KEYS[2]) == 1 then
        if redis.call('PTTL', KEYS[2]) < 0 then
          return -1
        end
        return 2
      end
      redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
      return 1
      """);

  private static final DefaultRedisScript<Long> PREFLIGHT_DISPATCH_SCRIPT = longScript("""
      local failure = redis.call('GET', KEYS[2])
      if redis.call('GET', KEYS[4]) ~= ARGV[1] then
        return 3
      end
      if redis.call('PTTL', KEYS[4]) < 0 then
        return -1
      end
      if failure then
        if not string.match(failure, '^%d+$') or redis.call('PTTL', KEYS[2]) < 0 then
          return -1
        end
        if tonumber(failure) >= tonumber(ARGV[2]) then
          return 0
        end
      end
      if redis.call('EXISTS', KEYS[3]) == 1 then
        if redis.call('PTTL', KEYS[3]) < 0 then
          return -1
        end
        return 2
      end
      return 1
      """);

  private static final DefaultRedisScript<String> CLAIM_SCRIPT = stringScript("""
      local failure = redis.call('GET', KEYS[3])
      if failure then
        if not string.match(failure, '^%d+$') or redis.call('PTTL', KEYS[3]) < 0 then
          return 'CORRUPT|0|0'
        end
      end
      local attempts = tonumber(failure) or 0
      if attempts >= tonumber(ARGV[4]) then
        return 'BLOCKED|' .. attempts .. '|' .. math.max(0, redis.call('PTTL', KEYS[3]))
      end

      local activeDispatch = redis.call('GET', KEYS[4])
      if activeDispatch then
        local dispatchTtl = redis.call('PTTL', KEYS[4])
        if dispatchTtl < 0 then
          return 'CORRUPT|0|0'
        end
        return 'CLAIM_IN_PROGRESS|' .. attempts .. '|' .. dispatchTtl
      end

      local challenge = redis.call('GET', KEYS[1])
      if not challenge then
        return 'MISSING|' .. attempts .. '|0'
      end
      if redis.call('PTTL', KEYS[1]) < 0 then
        return 'CORRUPT|0|0'
      end
      if challenge ~= ARGV[1] then
        return 'STALE|' .. attempts .. '|0'
      end

      local activeClaim = redis.call('GET', KEYS[2])
      if activeClaim then
        local claimTtl = redis.call('PTTL', KEYS[2])
        if claimTtl < 0 then
          return 'CORRUPT|0|0'
        end
        if ARGV[2] == '1' and activeClaim == ARGV[3] then
          return 'CLAIMED|' .. attempts .. '|' .. claimTtl
        end
        return 'CLAIM_IN_PROGRESS|' .. attempts .. '|' .. claimTtl
      end

      if ARGV[2] == '1' then
        redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[5])
        return 'CLAIMED|' .. attempts .. '|' .. ARGV[5]
      end

      attempts = redis.call('INCR', KEYS[3])
      redis.call('PEXPIRE', KEYS[3], ARGV[6])
      if attempts >= tonumber(ARGV[4]) then
        redis.call('DEL', KEYS[1])
        redis.call('SET', KEYS[3], ARGV[4], 'PX', ARGV[6])
        return 'BLOCKED|' .. ARGV[4] .. '|' .. ARGV[6]
      end
      return 'INVALID|' .. attempts .. '|0'
      """);

  private static final DefaultRedisScript<String> INSPECT_SCRIPT = stringScript("""
      local failure = redis.call('GET', KEYS[3])
      if failure then
        if not string.match(failure, '^%d+$') or redis.call('PTTL', KEYS[3]) < 0 then
          return 'CORRUPT|0|0|'
        end
      end
      local attempts = tonumber(failure) or 0
      if attempts >= tonumber(ARGV[1]) then
        return 'BLOCKED|' .. attempts .. '|'
            .. math.max(0, redis.call('PTTL', KEYS[3])) .. '|'
      end

      local activeDispatch = redis.call('GET', KEYS[4])
      if activeDispatch then
        local dispatchTtl = redis.call('PTTL', KEYS[4])
        if dispatchTtl < 0 then
          return 'CORRUPT|0|0|'
        end
        return 'CLAIM_IN_PROGRESS|' .. attempts .. '|' .. dispatchTtl .. '|'
      end

      local challenge = redis.call('GET', KEYS[1])
      if not challenge then
        return 'MISSING|' .. attempts .. '|0|'
      end
      local challengeTtl = redis.call('PTTL', KEYS[1])
      if challengeTtl < 0 then
        return 'CORRUPT|0|0|'
      end

      local activeClaim = redis.call('GET', KEYS[2])
      if activeClaim then
        local claimTtl = redis.call('PTTL', KEYS[2])
        if claimTtl < 0 then
          return 'CORRUPT|0|0|'
        end
        return 'CLAIM_IN_PROGRESS|' .. attempts .. '|' .. claimTtl .. '|'
      end
      return 'READY|' .. attempts .. '|' .. challengeTtl .. '|' .. challenge
      """);

  private static final DefaultRedisScript<Long> FINALIZE_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      if redis.call('GET', KEYS[2]) ~= ARGV[2] then
        return 0
      end
      redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4])
      return 1
      """);

  private static final DefaultRedisScript<Long> COMPARE_DELETE_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      return redis.call('DEL', KEYS[1])
      """);

  private static final DefaultRedisScript<Long> DELETE_UNCLAIMED_CHALLENGE_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      if redis.call('EXISTS', KEYS[2]) == 1 then
        return 2
      end
      return redis.call('DEL', KEYS[1])
      """);

  private static final DefaultRedisScript<Long> ACQUIRE_LOCK_SCRIPT = longScript("""
      local owner = redis.call('GET', KEYS[1])
      if owner == ARGV[1] then
        if redis.call('PTTL', KEYS[1]) < 0 then
          return -1
        end
        return 1
      end
      if owner then
        if redis.call('PTTL', KEYS[1]) < 0 then
          return -1
        end
        return 0
      end
      redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
      return 1
      """);

  private static final DefaultRedisScript<Long> RENEW_LOCK_SCRIPT = longScript("""
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return 0
      end
      if redis.call('PTTL', KEYS[1]) < 0 then
        return -1
      end
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
      return 1
      """);

  private static final DefaultRedisScript<String> RESERVE_RESEND_SCRIPT = stringScript("""
      local time = redis.call('TIME')
      local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
      local window = tonumber(ARGV[2])
      local maximum = tonumber(ARGV[3])
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)

      if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
        local current = redis.call('ZCARD', KEYS[1])
        return 'RESERVED|' .. math.max(0, maximum - current) .. '|0'
      end

      local count = redis.call('ZCARD', KEYS[1])
      if count >= maximum then
        local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
        local retry = math.max(1, math.ceil(tonumber(first[2]) + window - now))
        return 'LIMITED|0|' .. retry
      end

      redis.call('ZADD', KEYS[1], now, ARGV[1])
      redis.call('PEXPIRE', KEYS[1], window)
      return 'RESERVED|' .. math.max(0, maximum - count - 1) .. '|0'
      """);

  private static final DefaultRedisScript<Long> ROLLBACK_RESEND_SCRIPT = longScript("""
      local removed = redis.call('ZREM', KEYS[1], ARGV[1])
      if redis.call('ZCARD', KEYS[1]) == 0 then
        redis.call('DEL', KEYS[1])
      end
      return removed
      """);

  private final StringRedisTemplate redis;
  private final OtpProperties properties;

  public RedisOtpChallengeStore(StringRedisTemplate redis, OtpProperties properties) {
    this.redis = Objects.requireNonNull(redis, "redis is required");
    this.properties = Objects.requireNonNull(properties, "properties are required");
  }

  public InstallResult installChallenge(
      String emailKey,
      String storedChallenge,
      String dispatchToken) {
    Keys keys = keys(emailKey);
    Long result = redis.execute(
        INSTALL_SCRIPT,
        List.of(keys.challenge(), keys.claim(), keys.failure(), keys.dispatch()),
        requireStoredChallenge(storedChallenge),
        Long.toString(properties.ttlMillis()),
        Integer.toString(properties.maxFailedAttempts()),
        requireOpaqueToken(dispatchToken, "dispatchToken"));
    long status = requireScriptResult(result, "install challenge");
    if (status == 0L) {
      return InstallResult.FAILURE_BLOCKED;
    }
    if (status == 1L) {
      return InstallResult.INSTALLED;
    }
    if (status == 2L) {
      return InstallResult.CLAIM_IN_PROGRESS;
    }
    if (status == 3L) {
      return InstallResult.DISPATCH_LOCK_NOT_OWNED;
    }
    if (status == -1L) {
      throw new IllegalStateException("OTP failure state is corrupt");
    }
    throw new IllegalStateException("unexpected OTP install result: " + result);
  }

  public DispatchPreflightResult preflightDispatch(
      String emailKey,
      String dispatchToken) {
    Keys keys = keys(emailKey);
    Long result = redis.execute(
        PREFLIGHT_DISPATCH_SCRIPT,
        List.of(keys.challenge(), keys.failure(), keys.claim(), keys.dispatch()),
        requireOpaqueToken(dispatchToken, "dispatchToken"),
        Integer.toString(properties.maxFailedAttempts()));
    long status = requireScriptResult(result, "preflight dispatch");
    if (status == 0L) {
      return DispatchPreflightResult.FAILURE_BLOCKED;
    }
    if (status == 1L) {
      return DispatchPreflightResult.READY;
    }
    if (status == 2L) {
      return DispatchPreflightResult.CLAIM_IN_PROGRESS;
    }
    if (status == 3L) {
      return DispatchPreflightResult.DISPATCH_LOCK_NOT_OWNED;
    }
    if (status == -1L) {
      throw new IllegalStateException("OTP dispatch preflight state is corrupt");
    }
    throw new IllegalStateException("unexpected OTP dispatch preflight result: " + result);
  }

  public Optional<String> readChallenge(String emailKey) {
    return Optional.ofNullable(redis.opsForValue().get(keys(emailKey).challenge()));
  }

  public ChallengeInspection inspectChallenge(String emailKey) {
    Keys keys = keys(emailKey);
    String result = redis.execute(
        INSPECT_SCRIPT,
        List.of(keys.challenge(), keys.claim(), keys.failure(), keys.dispatch()),
        Integer.toString(properties.maxFailedAttempts()));
    return parseChallengeInspection(requireScriptResult(result, "inspect challenge"));
  }

  public ClaimResult claimChallenge(
      String emailKey,
      String expectedChallenge,
      boolean challengeMatches,
      String claimToken) {
    Keys keys = keys(emailKey);
    String result = redis.execute(
        CLAIM_SCRIPT,
        List.of(keys.challenge(), keys.claim(), keys.failure(), keys.dispatch()),
        requireStoredChallenge(expectedChallenge),
        challengeMatches ? "1" : "0",
        requireOpaqueToken(claimToken, "claimToken"),
        Integer.toString(properties.maxFailedAttempts()),
        Long.toString(properties.claimTtlMillis()),
        Long.toString(properties.failureBlockMillis()));
    return parseClaimResult(requireScriptResult(result, "claim challenge"));
  }

  public boolean finalizeClaim(
      String emailKey,
      String expectedChallenge,
      String claimToken) {
    Keys keys = keys(emailKey);
    Long result = redis.execute(
        FINALIZE_SCRIPT,
        List.of(keys.challenge(), keys.claim(), keys.failure(), keys.resends()),
        requireStoredChallenge(expectedChallenge),
        requireOpaqueToken(claimToken, "claimToken"));
    return requireScriptResult(result, "finalize claim") == 1L;
  }

  public boolean releaseClaim(String emailKey, String claimToken) {
    Keys keys = keys(emailKey);
    return compareAndDelete(
        keys.claim(),
        requireOpaqueToken(claimToken, "claimToken"),
        "release claim");
  }

  public ResendReservationResult reserveResend(
      String emailKey,
      String reservationToken) {
    Keys keys = keys(emailKey);
    String result = redis.execute(
        RESERVE_RESEND_SCRIPT,
        List.of(keys.resends()),
        requireOpaqueToken(reservationToken, "reservationToken"),
        Long.toString(properties.resendWindowMillis()),
        Integer.toString(properties.maxResends()));
    return parseResendResult(requireScriptResult(result, "reserve resend"));
  }

  public boolean rollbackResendReservation(
      String emailKey,
      String reservationToken) {
    Keys keys = keys(emailKey);
    Long result = redis.execute(
        ROLLBACK_RESEND_SCRIPT,
        List.of(keys.resends()),
        requireOpaqueToken(reservationToken, "reservationToken"));
    return requireScriptResult(result, "rollback resend reservation") == 1L;
  }

  public boolean acquireDispatchLock(String emailKey, String dispatchToken) {
    Keys keys = keys(emailKey);
    Long result = redis.execute(
        ACQUIRE_LOCK_SCRIPT,
        List.of(keys.dispatch()),
        requireOpaqueToken(dispatchToken, "dispatchToken"),
        Long.toString(properties.dispatchLockTtlMillis()));
    long status = requireScriptResult(result, "acquire dispatch lock");
    if (status == -1L) {
      throw new IllegalStateException("OTP dispatch lock state is corrupt");
    }
    return status == 1L;
  }

  public boolean renewDispatchLock(String emailKey, String dispatchToken) {
    Keys keys = keys(emailKey);
    Long result = redis.execute(
        RENEW_LOCK_SCRIPT,
        List.of(keys.dispatch()),
        requireOpaqueToken(dispatchToken, "dispatchToken"),
        Long.toString(properties.dispatchLockTtlMillis()));
    long status = requireScriptResult(result, "renew dispatch lock");
    if (status == -1L) {
      throw new IllegalStateException("OTP dispatch lock state is corrupt");
    }
    if (status == 0L || status == 1L) {
      return status == 1L;
    }
    throw new IllegalStateException("unexpected OTP dispatch renew result: " + result);
  }

  public boolean releaseDispatchLock(String emailKey, String dispatchToken) {
    Keys keys = keys(emailKey);
    return compareAndDelete(
        keys.dispatch(),
        requireOpaqueToken(dispatchToken, "dispatchToken"),
        "release dispatch lock");
  }

  public boolean compareAndDeleteChallenge(
      String emailKey,
      String expectedChallenge) {
    Keys keys = keys(emailKey);
    Long result = redis.execute(
        DELETE_UNCLAIMED_CHALLENGE_SCRIPT,
        List.of(keys.challenge(), keys.claim()),
        requireStoredChallenge(expectedChallenge));
    return requireScriptResult(result, "delete challenge") == 1L;
  }

  public KeyTtl challengeTtl(String emailKey) {
    return ttl(keys(emailKey).challenge());
  }

  public KeyTtl claimTtl(String emailKey) {
    return ttl(keys(emailKey).claim());
  }

  public KeyTtl failureTtl(String emailKey) {
    return ttl(keys(emailKey).failure());
  }

  public KeyTtl resendTtl(String emailKey) {
    return ttl(keys(emailKey).resends());
  }

  public KeyTtl dispatchLockTtl(String emailKey) {
    return ttl(keys(emailKey).dispatch());
  }

  private boolean compareAndDelete(String key, String expected, String operation) {
    Long result = redis.execute(
        COMPARE_DELETE_SCRIPT,
        List.of(key),
        expected);
    return requireScriptResult(result, operation) == 1L;
  }

  private KeyTtl ttl(String key) {
    Long milliseconds = redis.getExpire(key, TimeUnit.MILLISECONDS);
    if (milliseconds == null || milliseconds == -2L) {
      return KeyTtl.missing();
    }
    if (milliseconds == -1L) {
      return KeyTtl.persistent();
    }
    if (milliseconds < -2L) {
      throw new IllegalStateException("unexpected Redis TTL result: " + milliseconds);
    }
    return KeyTtl.expiring(Duration.ofMillis(milliseconds));
  }

  private static ClaimResult parseClaimResult(String value) {
    String[] parts = value.split("\\|", -1);
    if (parts.length != 3 || "CORRUPT".equals(parts[0])) {
      throw new IllegalStateException("OTP claim state is corrupt");
    }
    try {
      ClaimStatus status = ClaimStatus.valueOf(parts[0]);
      int attempts = Integer.parseInt(parts[1]);
      long retryMillis = Long.parseLong(parts[2]);
      if (attempts < 0 || retryMillis < 0) {
        throw new IllegalStateException("OTP claim result contains a negative value");
      }
      return new ClaimResult(status, attempts, Duration.ofMillis(retryMillis));
    } catch (IllegalArgumentException exception) {
      throw new IllegalStateException("unexpected OTP claim result", exception);
    }
  }

  static ChallengeInspection parseChallengeInspection(String value) {
    String[] parts = value.split("\\|", -1);
    if (parts.length != 4 || "CORRUPT".equals(parts[0])) {
      throw new IllegalStateException("OTP challenge state is corrupt");
    }
    try {
      ChallengeState state = ChallengeState.valueOf(parts[0]);
      int attempts = Integer.parseInt(parts[1]);
      long retryMillis = Long.parseLong(parts[2]);
      if (attempts < 0 || retryMillis < 0) {
        throw new IllegalStateException("OTP inspection contains a negative value");
      }
      String storedChallenge = parts[3].isEmpty() ? null : parts[3];
      if (state == ChallengeState.READY) {
        requireStoredChallenge(storedChallenge);
      } else if (storedChallenge != null) {
        throw new IllegalStateException("only a ready OTP may expose a challenge snapshot");
      }
      return new ChallengeInspection(
          state,
          storedChallenge,
          attempts,
          Duration.ofMillis(retryMillis));
    } catch (IllegalArgumentException exception) {
      throw new IllegalStateException("unexpected OTP inspection result", exception);
    }
  }

  private static ResendReservationResult parseResendResult(String value) {
    String[] parts = value.split("\\|", -1);
    if (parts.length != 3) {
      throw new IllegalStateException("unexpected OTP resend result");
    }
    try {
      boolean reserved = switch (parts[0]) {
        case "RESERVED" -> true;
        case "LIMITED" -> false;
        default -> throw new IllegalStateException("unexpected OTP resend status");
      };
      int remaining = Integer.parseInt(parts[1]);
      long retryMillis = Long.parseLong(parts[2]);
      if (remaining < 0 || retryMillis < 0) {
        throw new IllegalStateException("OTP resend result contains a negative value");
      }
      return new ResendReservationResult(
          reserved,
          remaining,
          Duration.ofMillis(retryMillis));
    } catch (IllegalArgumentException exception) {
      throw new IllegalStateException("unexpected OTP resend result", exception);
    }
  }

  private static Keys keys(String emailKey) {
    String safeEmailKey = requireEmailKey(emailKey);
    String root = "auth:registration:{" + safeEmailKey + "}:";
    return new Keys(
        root + "challenge",
        root + "claim",
        root + "fail",
        root + "resends",
        root + "dispatch");
  }

  private static String requireEmailKey(String value) {
    if (value == null || !EMAIL_KEY.matcher(value).matches()) {
      throw new IllegalArgumentException("emailKey must be a base64url SHA-256 HMAC");
    }
    return value;
  }

  private static String requireStoredChallenge(String value) {
    if (value == null || !STORED_CHALLENGE.matcher(value).matches()) {
      throw new IllegalArgumentException("storedChallenge has an invalid format");
    }
    return value;
  }

  private static String requireOpaqueToken(String value, String field) {
    if (value == null || !OPAQUE_TOKEN.matcher(value).matches()) {
      throw new IllegalArgumentException(
          field + " must be a 16-128 character base64url token");
    }
    return value;
  }

  private static <T> T requireScriptResult(T value, String operation) {
    if (value == null) {
      throw new IllegalStateException("Redis returned no result for " + operation);
    }
    return value;
  }

  private static DefaultRedisScript<Long> longScript(String source) {
    return new DefaultRedisScript<>(source, Long.class);
  }

  private static DefaultRedisScript<String> stringScript(String source) {
    return new DefaultRedisScript<>(source, String.class);
  }

  private record Keys(
      String challenge,
      String claim,
      String failure,
      String resends,
      String dispatch) {}

  public enum InstallResult {
    INSTALLED,
    FAILURE_BLOCKED,
    CLAIM_IN_PROGRESS,
    DISPATCH_LOCK_NOT_OWNED
  }

  public enum DispatchPreflightResult {
    READY,
    FAILURE_BLOCKED,
    CLAIM_IN_PROGRESS,
    DISPATCH_LOCK_NOT_OWNED
  }

  public enum ClaimStatus {
    CLAIMED,
    INVALID,
    BLOCKED,
    MISSING,
    STALE,
    CLAIM_IN_PROGRESS
  }

  public enum ChallengeState {
    READY,
    BLOCKED,
    MISSING,
    CLAIM_IN_PROGRESS
  }

  public record ChallengeInspection(
      ChallengeState state,
      String storedChallenge,
      int failedAttempts,
      Duration retryAfter) {
    public ChallengeInspection {
      Objects.requireNonNull(state, "state is required");
      Objects.requireNonNull(retryAfter, "retryAfter is required");
      if (failedAttempts < 0 || retryAfter.isNegative()) {
        throw new IllegalArgumentException("inspection values cannot be negative");
      }
      if ((state == ChallengeState.READY) != (storedChallenge != null)) {
        throw new IllegalArgumentException(
            "only a ready inspection may contain a challenge snapshot");
      }
    }


    @Override
    public String toString() {
      return "ChallengeInspection[state=" + state
          + ", storedChallenge=" + (storedChallenge == null ? "null" : "<redacted>")
          + ", failedAttempts=" + failedAttempts
          + ", retryAfter=" + retryAfter + "]";
    }
  }

  public record ClaimResult(
      ClaimStatus status,
      int failedAttempts,
      Duration retryAfter) {
    public ClaimResult {
      Objects.requireNonNull(status, "status is required");
      Objects.requireNonNull(retryAfter, "retryAfter is required");
      if (failedAttempts < 0 || retryAfter.isNegative()) {
        throw new IllegalArgumentException("claim result values cannot be negative");
      }
    }
  }

  public record ResendReservationResult(
      boolean reserved,
      int remainingPermits,
      Duration retryAfter) {
    public ResendReservationResult {
      Objects.requireNonNull(retryAfter, "retryAfter is required");
      if (remainingPermits < 0 || retryAfter.isNegative()) {
        throw new IllegalArgumentException("resend result values cannot be negative");
      }
    }
  }

  public enum TtlState {
    MISSING,
    PERSISTENT,
    EXPIRING
  }

  public record KeyTtl(TtlState state, Duration remaining) {
    public KeyTtl {
      Objects.requireNonNull(state, "state is required");
      if (state == TtlState.EXPIRING) {
        Objects.requireNonNull(remaining, "remaining is required for an expiring key");
        if (remaining.isNegative()) {
          throw new IllegalArgumentException("remaining TTL cannot be negative");
        }
      } else if (remaining != null) {
        throw new IllegalArgumentException("remaining TTL is only valid for an expiring key");
      }
    }

    static KeyTtl missing() {
      return new KeyTtl(TtlState.MISSING, null);
    }

    static KeyTtl persistent() {
      return new KeyTtl(TtlState.PERSISTENT, null);
    }

    static KeyTtl expiring(Duration remaining) {
      return new KeyTtl(TtlState.EXPIRING, remaining);
    }
  }
}
