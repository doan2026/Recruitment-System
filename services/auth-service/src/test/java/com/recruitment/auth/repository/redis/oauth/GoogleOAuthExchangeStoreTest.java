package com.recruitment.auth.repository.redis.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.auth.config.properties.GoogleOAuthProperties;
import com.recruitment.auth.dto.oauth.GoogleOAuthRole;
import com.recruitment.auth.model.oauth.GoogleOAuthIdentity;
import com.recruitment.auth.security.oauth.GoogleOAuthTokenCodec;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

@ExtendWith(MockitoExtension.class)
class GoogleOAuthExchangeStoreTest {
  private static final String CODE = "A".repeat(43);
  private static final String BINDER = "B".repeat(43);
  private static final String CODE_DIGEST = "C".repeat(43);
  private static final String BINDER_DIGEST = "D".repeat(43);

  @Mock
  StringRedisTemplate redis;

  @Mock
  GoogleOAuthTokenCodec tokenCodec;

  @SuppressWarnings("unchecked")
  ValueOperations<String, String> values = mock(ValueOperations.class);

  GoogleOAuthExchangeStore store;

  @BeforeEach
  void setUp() {
    store = new GoogleOAuthExchangeStore(
        redis, new ObjectMapper().findAndRegisterModules(), tokenCodec, properties());
  }

  @Test
  void storesOnlyDigestsOfOpaqueCodeAndBinder() {
    when(redis.opsForValue()).thenReturn(values);
    when(tokenCodec.generate()).thenReturn(CODE, BINDER);
    when(tokenCodec.digest(BINDER)).thenReturn(BINDER_DIGEST);
    when(tokenCodec.digest(CODE)).thenReturn(CODE_DIGEST);
    when(values.setIfAbsent(
        eq("auth:google:exchange:v1:" + CODE_DIGEST),
        any(String.class),
        eq(Duration.ofMinutes(2)))).thenReturn(true);

    GoogleOAuthExchangeStore.PendingExchange pending =
        store.create("google-subject", "candidate@example.com", GoogleOAuthRole.RECRUITER);

    assertThat(pending.code()).isEqualTo(CODE);
    assertThat(pending.binder()).isEqualTo(BINDER);
    assertThat(pending.toString()).doesNotContain(CODE, BINDER);
    ArgumentCaptor<String> serialized = ArgumentCaptor.forClass(String.class);
    verify(values).setIfAbsent(
        eq("auth:google:exchange:v1:" + CODE_DIGEST),
        serialized.capture(),
        eq(Duration.ofMinutes(2)));
    assertThat(serialized.getValue())
        .contains(BINDER_DIGEST, "google-subject", "candidate@example.com", "RECRUITER")
        .doesNotContain(CODE, BINDER);
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void atomicallyConsumesOnlyWhenBinderDigestMatches() {
    when(tokenCodec.digest(CODE)).thenReturn(CODE_DIGEST);
    when(tokenCodec.digest(BINDER)).thenReturn(BINDER_DIGEST);
    String serialized = """
        {"binderDigest":"%s","subject":"google-subject",\
        "normalizedEmail":"candidate@example.com","role":"RECRUITER"}
        """.formatted(BINDER_DIGEST).replace("\\\n", "");
    when(redis.execute(
        any(RedisScript.class),
        eq(List.of("auth:google:exchange:v1:" + CODE_DIGEST)),
        eq(BINDER_DIGEST))).thenReturn(serialized);

    Optional<GoogleOAuthExchangeStore.VerifiedExchange> identity = store.consume(CODE, BINDER);

    assertThat(identity).contains(
        new GoogleOAuthExchangeStore.VerifiedExchange(
            new GoogleOAuthIdentity("google-subject", "candidate@example.com"), GoogleOAuthRole.RECRUITER));
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void binderMismatchDoesNotYieldIdentity() {
    when(tokenCodec.digest(CODE)).thenReturn(CODE_DIGEST);
    when(tokenCodec.digest(BINDER)).thenReturn(BINDER_DIGEST);
    when(redis.execute(
        any(RedisScript.class),
        eq(List.of("auth:google:exchange:v1:" + CODE_DIGEST)),
        eq(BINDER_DIGEST))).thenReturn("BINDER_MISMATCH");

    assertThat(store.consume(CODE, BINDER)).isEmpty();
  }

  private static GoogleOAuthProperties properties() {
    return new GoogleOAuthProperties(
        true,
        "client-id",
        "client-secret",
        "https://auth.example.com/auth/google/callback",
        "https://app.example.com/oauth/callback",
        true,
        Duration.ofMinutes(10),
        Duration.ofMinutes(2));
  }
}
