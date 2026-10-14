package com.recruitment.auth.repository.redis.login;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;
import com.recruitment.auth.config.properties.LoginProperties;
import com.recruitment.auth.exception.LoginAttemptStoreUnavailableException;
import com.recruitment.auth.repository.redis.login.LoginAttemptLimiter.AttemptDecision;
import com.recruitment.auth.repository.redis.login.LoginAttemptLimiter.State;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

class RedisLoginAttemptLimiterTest {
  private static final String EMAIL = "candidate@example.com";
  private static final String SECRET = "login-hmac-secret-with-at-least-32-bytes";

  @Test
  void derivesDeterministicOpaqueClusterSafeKeysWithoutEmailPii() {
    RedisLoginAttemptLimiter limiter = limiter(org.mockito.Mockito.mock(
        StringRedisTemplate.class));

    String emailKey = limiter.emailKey(EMAIL);
    List<String> keys = limiter.keys(EMAIL);

    assertThat(emailKey).matches("[A-Za-z0-9_-]{43}");
    assertThat(limiter.emailKey(EMAIL)).isEqualTo(emailKey);
    assertThat(limiter.emailKey("other@example.com")).isNotEqualTo(emailKey);
    assertThat(keys).containsExactly(
        "auth:login:v1:{" + emailKey + "}:fail",
        "auth:login:v1:{" + emailKey + "}:block");
    assertThat(keys.toString()).doesNotContain(EMAIL).doesNotContain("candidate");
  }

  @Test
  void parsesAllowedFailedAndBlockedStates() {
    assertThat(RedisLoginAttemptLimiter.parseDecision("ALLOWED|0|0", 5))
        .isEqualTo(AttemptDecision.allowed(0));
    assertThat(RedisLoginAttemptLimiter.parseDecision("FAILED|4|0", 5))
        .isEqualTo(AttemptDecision.failed(4));

    AttemptDecision blocked = RedisLoginAttemptLimiter.parseDecision(
        "BLOCKED|5|899999", 5);
    assertThat(blocked.state()).isEqualTo(State.BLOCKED);
    assertThat(blocked.failedAttempts()).isEqualTo(5);
    assertThat(blocked.retryAfter()).isEqualTo(Duration.ofMillis(899999));
  }

  @Test
  void corruptOrIncoherentRedisResultsFailClosed() {
    assertThatThrownBy(() -> RedisLoginAttemptLimiter.parseDecision(null, 5))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> RedisLoginAttemptLimiter.parseDecision("CORRUPT|0|0", 5))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> RedisLoginAttemptLimiter.parseDecision("ALLOWED|5|0", 5))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> RedisLoginAttemptLimiter.parseDecision("FAILED|5|0", 5))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> RedisLoginAttemptLimiter.parseDecision("BLOCKED|4|1", 5))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> RedisLoginAttemptLimiter.parseDecision("BLOCKED|5|0", 5))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> RedisLoginAttemptLimiter.parseDecision(
        "BLOCKED|not-a-number|1000", 5))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  @SuppressWarnings({"unchecked", "rawtypes"})
  void redisConnectivityFailureIsWrappedAsFailClosedStoreFailure() {
    StringRedisTemplate redis = org.mockito.Mockito.mock(StringRedisTemplate.class);
    when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class),
            anyList(), any(Object[].class)))
        .thenThrow(new RedisConnectionFailureException("offline"));
    RedisLoginAttemptLimiter limiter = limiter(redis);

    assertThatThrownBy(() -> limiter.preflight(EMAIL))
        .isInstanceOf(LoginAttemptStoreUnavailableException.class)
        .hasMessageContaining("unavailable")
        .hasRootCauseMessage("offline");
  }

  @Test
  void decisionRejectsRetryDelayForNonBlockedState() {
    assertThatThrownBy(() -> new AttemptDecision(
        State.ALLOWED, 0, Duration.ofSeconds(1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private RedisLoginAttemptLimiter limiter(StringRedisTemplate redis) {
    return new RedisLoginAttemptLimiter(redis, new LoginProperties(
        SECRET, Duration.ofMinutes(15), Duration.ofMinutes(15), 5));
  }
}
