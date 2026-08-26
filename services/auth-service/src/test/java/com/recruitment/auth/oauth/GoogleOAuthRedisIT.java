package com.recruitment.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.PkceParameterNames;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@Testcontainers
@Timeout(30)
class GoogleOAuthRedisIT {
  private static final String REDIS_PASSWORD = "google-oauth-test-password";

  @Container
  static final GenericContainer<?> REDIS =
      new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
          .withExposedPorts(6379)
          .withCommand("redis-server", "--requirepass", REDIS_PASSWORD);

  LettuceConnectionFactory connectionFactory;
  StringRedisTemplate redis;
  GoogleOAuthTokenCodec tokenCodec;
  GoogleOAuthProperties properties;

  @BeforeEach
  void connect() {
    RedisStandaloneConfiguration configuration = new RedisStandaloneConfiguration(
        REDIS.getHost(), REDIS.getMappedPort(6379));
    configuration.setPassword(RedisPassword.of(REDIS_PASSWORD));
    connectionFactory = new LettuceConnectionFactory(configuration);
    connectionFactory.afterPropertiesSet();
    redis = new StringRedisTemplate(connectionFactory);
    redis.afterPropertiesSet();
    redis.execute((RedisCallback<Void>) connection -> {
      connection.serverCommands().flushDb();
      return null;
    });
    tokenCodec = new GoogleOAuthTokenCodec(new SecureRandom());
    properties = properties();
  }

  @AfterEach
  void disconnect() {
    connectionFactory.destroy();
  }

  @Test
  void exchangeBinderMismatchDoesNotConsumeButSuccessIsExactlyOnce() {
    GoogleOAuthExchangeStore store = new GoogleOAuthExchangeStore(
        redis, new ObjectMapper().findAndRegisterModules(), tokenCodec, properties);

    GoogleOAuthExchangeStore.PendingExchange pending =
        store.create("google-subject", "candidate@example.com");

    Set<String> keys = redis.keys("auth:google:exchange:v1:*");
    assertThat(keys).hasSize(1).allSatisfy(key -> assertThat(key)
        .doesNotContain(pending.code(), pending.binder(), "candidate@example.com"));
    String stored = redis.opsForValue().get(keys.iterator().next());
    assertThat(stored)
        .doesNotContain(pending.code(), pending.binder())
        .contains("google-subject", "candidate@example.com");

    assertThat(store.consume(pending.code(), "W".repeat(43))).isEmpty();
    assertThat(store.consume(pending.code(), pending.binder()))
        .contains(new GoogleOAuthIdentity("google-subject", "candidate@example.com"));
    assertThat(store.consume(pending.code(), pending.binder())).isEmpty();
  }

  @Test
  void wrongCallbackStateCannotDeleteTheValidServerSideAuthorizationRequest() {
    RedisOAuth2AuthorizationRequestRepository repository =
        new RedisOAuth2AuthorizationRequestRepository(
            redis,
            new ObjectMapper().findAndRegisterModules(),
            tokenCodec,
            properties);
    MockHttpServletResponse authorizationResponse = new MockHttpServletResponse();
    repository.saveAuthorizationRequest(
        authorizationRequest(),
        new MockHttpServletRequest(),
        authorizationResponse);
    Cookie handle = authorizationResponse.getCookie(
        RedisOAuth2AuthorizationRequestRepository.COOKIE_NAME);
    assertThat(handle).isNotNull();

    MockHttpServletResponse attackerResponse = new MockHttpServletResponse();
    assertThat(repository.removeAuthorizationRequest(
        callback(handle, "wrong-state"), attackerResponse)).isNull();
    assertThat(attackerResponse.getHeader("Set-Cookie")).isNull();

    OAuth2AuthorizationRequest restored = repository.removeAuthorizationRequest(
        callback(handle, "valid-state"), new MockHttpServletResponse());
    assertThat(restored).isNotNull();
    assertThat(restored.<String>getAttribute(OidcParameterNames.NONCE))
        .isEqualTo("raw-nonce");
    assertThat(restored.<String>getAttribute(PkceParameterNames.CODE_VERIFIER))
        .isEqualTo("code-verifier");
    assertThat(repository.removeAuthorizationRequest(
        callback(handle, "valid-state"), new MockHttpServletResponse())).isNull();
  }

  private static MockHttpServletRequest callback(Cookie handle, String state) {
    MockHttpServletRequest request = new MockHttpServletRequest(
        "GET", GoogleOAuthSecurityConfigurer.CALLBACK_URI);
    request.setCookies(new Cookie(handle.getName(), handle.getValue()));
    request.setParameter("state", state);
    return request;
  }

  private static OAuth2AuthorizationRequest authorizationRequest() {
    return OAuth2AuthorizationRequest.authorizationCode()
        .authorizationUri("https://accounts.google.test/o/oauth2/v2/auth")
        .clientId("client-id")
        .redirectUri("https://auth.example.com/auth/google/callback")
        .scopes(Set.of("openid", "profile", "email"))
        .state("valid-state")
        .additionalParameters(Map.of(
            OidcParameterNames.NONCE, "hashed-nonce",
            PkceParameterNames.CODE_CHALLENGE, "code-challenge",
            PkceParameterNames.CODE_CHALLENGE_METHOD, "S256"))
        .attributes(Map.of(
            "registration_id", "google",
            OidcParameterNames.NONCE, "raw-nonce",
            PkceParameterNames.CODE_VERIFIER, "code-verifier"))
        .authorizationRequestUri(
            "https://accounts.google.test/o/oauth2/v2/auth?state=valid-state")
        .build();
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
