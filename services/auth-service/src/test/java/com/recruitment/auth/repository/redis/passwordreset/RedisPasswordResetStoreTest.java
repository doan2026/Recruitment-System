package com.recruitment.auth.repository.redis.passwordreset;

import com.recruitment.auth.support.PasswordResetTestFixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore.Binding;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore.ClaimStatus;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

class RedisPasswordResetStoreTest {
  private static final UUID USER_ID =
      UUID.fromString("11111111-2222-4333-8444-555555555555");
  private static final String DIGEST = "a".repeat(64);
  private static final String OPAQUE_KEY = "b".repeat(43);

  @Test
  void parsesClaimedBindingAndTtlWithoutAnyRawToken() {
    var result = RedisPasswordResetStore.parseClaimResult(
        "CLAIMED|v1." + USER_ID + ".7|29999");

    assertThat(result.status()).isEqualTo(ClaimStatus.CLAIMED);
    assertThat(result.binding()).isEqualTo(new Binding(USER_ID, 7));
    assertThat(result.retryAfter()).isEqualTo(Duration.ofMillis(29999));
    assertThat(result.toString()).doesNotContain("pr1_");
  }

  @Test
  void parsesMissingAndInProgressWithoutExposingBinding() {
    var missing = RedisPasswordResetStore.parseClaimResult("MISSING||0");
    var inProgress =
        RedisPasswordResetStore.parseClaimResult("IN_PROGRESS||1201");

    assertThat(missing.status()).isEqualTo(ClaimStatus.MISSING);
    assertThat(missing.binding()).isNull();
    assertThat(missing.retryAfter()).isZero();
    assertThat(inProgress.status()).isEqualTo(ClaimStatus.IN_PROGRESS);
    assertThat(inProgress.binding()).isNull();
    assertThat(inProgress.retryAfter()).isEqualTo(Duration.ofMillis(1201));
  }

  @Test
  void rejectsCorruptOrIncoherentClaimState() {
    assertThatThrownBy(
        () -> RedisPasswordResetStore.parseClaimResult("CORRUPT||0"))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
        () -> RedisPasswordResetStore.parseClaimResult("CLAIMED||1000"))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
        () -> RedisPasswordResetStore.parseClaimResult(
            "IN_PROGRESS|v1." + USER_ID + ".0|1000"))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
        () -> RedisPasswordResetStore.parseClaimResult("MISSING||1"))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void allKeysShareOneClusterSlotAndActiveKeyHidesUserId() {
    RedisPasswordResetStore store = new RedisPasswordResetStore(
        org.mockito.Mockito.mock(StringRedisTemplate.class),
        PasswordResetTestFixtures.properties());

    assertThat(store.challengeKey(DIGEST)).contains("{password-reset}");
    assertThat(store.claimKey(DIGEST)).contains("{password-reset}");
    assertThat(store.deliveryKey(DIGEST)).contains("{password-reset}");
    assertThat(store.requestKey(OPAQUE_KEY)).contains("{password-reset}");
    assertThat(store.activeKey(OPAQUE_KEY))
        .contains("{password-reset}")
        .doesNotContain(USER_ID.toString());
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void requestRollbackIsIdempotentAndCasRemovesOnlyItsExactMember() {
    String requestToken = "request-member-1234567890";
    StringRedisTemplate redis = org.mockito.Mockito.mock(StringRedisTemplate.class);
    RedisPasswordResetStore store = new RedisPasswordResetStore(
        redis, PasswordResetTestFixtures.properties());
    ArgumentCaptor<RedisScript> script = ArgumentCaptor.forClass(RedisScript.class);
    when(redis.execute(
        script.capture(),
        eq(List.of(store.requestKey(OPAQUE_KEY))),
        eq(requestToken))).thenReturn(1L, 0L);

    assertThat(store.rollbackRequest(OPAQUE_KEY, requestToken)).isTrue();
    assertThat(store.rollbackRequest(OPAQUE_KEY, requestToken)).isFalse();
    assertThat(script.getValue().getScriptAsString())
        .contains(
            "redis.call('EXISTS', KEYS[1]) == 0",
            "redis.call('ZREM', KEYS[1], ARGV[1])",
            "redis.call('ZCARD', KEYS[1]) == 0")
        .doesNotContain("ZREMRANGEBYSCORE");
  }

  @Test
  void bindingRoundTripRejectsNegativeOrMalformedVersions() {
    Binding binding = new Binding(USER_ID, 42);

    assertThat(Binding.parse(binding.serialize())).isEqualTo(binding);
    assertThatThrownBy(() -> new Binding(USER_ID, -1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Binding.parse("v1." + USER_ID + ".-1"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
