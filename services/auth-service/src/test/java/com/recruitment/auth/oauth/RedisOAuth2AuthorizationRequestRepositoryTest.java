package com.recruitment.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.PkceParameterNames;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;

@ExtendWith(MockitoExtension.class)
class RedisOAuth2AuthorizationRequestRepositoryTest {
  private static final String HANDLE = "H".repeat(43);
  private static final String HANDLE_DIGEST = "D".repeat(43);
  private static final String STATE = "spring-generated-state";

  @Mock
  StringRedisTemplate redis;

  @Mock
  GoogleOAuthTokenCodec tokenCodec;

  @SuppressWarnings("unchecked")
  ValueOperations<String, String> values = mock(ValueOperations.class);

  ObjectMapper mapper;
  RedisOAuth2AuthorizationRequestRepository repository;

  @BeforeEach
  void setUp() {
    mapper = new ObjectMapper().findAndRegisterModules();
    repository = new RedisOAuth2AuthorizationRequestRepository(
        redis, mapper, tokenCodec, properties());
  }

  @Test
  void savesJsonServerSideAndExposesOnlyOpaqueHttpOnlyHandle() {
    when(redis.opsForValue()).thenReturn(values);
    when(tokenCodec.generate()).thenReturn(HANDLE);
    when(tokenCodec.digest(HANDLE)).thenReturn(HANDLE_DIGEST);
    when(values.setIfAbsent(
        eq("auth:google:authorization-request:v1:" + HANDLE_DIGEST),
        any(String.class),
        eq(Duration.ofMinutes(10)))).thenReturn(true);
    MockHttpServletResponse response = new MockHttpServletResponse();

    repository.saveAuthorizationRequest(
        authorizationRequest(), new MockHttpServletRequest(), response);

    assertThat(response.getHeader(HttpHeaders.SET_COOKIE))
        .contains(
            "oauth2_authorization=" + HANDLE,
            "Path=/auth/google/callback",
            "Max-Age=600",
            "Secure",
            "HttpOnly",
            "SameSite=Lax")
        .doesNotContain(STATE, "raw-nonce", "code-verifier");
    ArgumentCaptor<String> serialized = ArgumentCaptor.forClass(String.class);
    verify(values).setIfAbsent(
        eq("auth:google:authorization-request:v1:" + HANDLE_DIGEST),
        serialized.capture(),
        eq(Duration.ofMinutes(10)));
    assertThat(serialized.getValue())
        .contains(STATE, "raw-nonce", "code-verifier")
        .doesNotContain(HANDLE, "@class", "java.util");
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void consumesMatchingStateAtomicallyAndClearsBrowserHandle() throws Exception {
    String serialized = mapper.writeValueAsString(
        RedisOAuth2AuthorizationRequestRepository.StoredAuthorizationRequest.from(
            authorizationRequest()));
    when(tokenCodec.requireToken(HANDLE)).thenReturn(HANDLE);
    when(tokenCodec.digest(HANDLE)).thenReturn(HANDLE_DIGEST);
    when(redis.execute(
        any(RedisScript.class),
        eq(List.of("auth:google:authorization-request:v1:" + HANDLE_DIGEST)),
        eq(STATE))).thenReturn(serialized);
    MockHttpServletRequest request = callbackRequest(STATE);
    MockHttpServletResponse response = new MockHttpServletResponse();

    OAuth2AuthorizationRequest restored =
        repository.removeAuthorizationRequest(request, response);

    assertThat(restored).isNotNull();
    assertThat(restored.<String>getAttribute(OidcParameterNames.NONCE))
        .isEqualTo("raw-nonce");
    assertThat(restored.<String>getAttribute(PkceParameterNames.CODE_VERIFIER))
        .isEqualTo("code-verifier");
    assertThat(response.getHeader(HttpHeaders.SET_COOKIE))
        .contains("oauth2_authorization=", "Max-Age=0", "HttpOnly", "SameSite=Lax");
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void mismatchingStateCannotConsumeOrClearTheValidBrowserFlow() {
    when(tokenCodec.requireToken(HANDLE)).thenReturn(HANDLE);
    when(tokenCodec.digest(HANDLE)).thenReturn(HANDLE_DIGEST);
    ArgumentCaptor<RedisScript> script = ArgumentCaptor.forClass(RedisScript.class);
    when(redis.execute(
        script.capture(),
        eq(List.of("auth:google:authorization-request:v1:" + HANDLE_DIGEST)),
        eq("attacker-state"))).thenReturn(null);
    MockHttpServletResponse response = new MockHttpServletResponse();

    assertThat(repository.removeAuthorizationRequest(
        callbackRequest("attacker-state"), response)).isNull();

    assertThat(response.getHeader(HttpHeaders.SET_COOKIE)).isNull();
    assertThat(script.getValue().getScriptAsString())
        .contains("decoded.state ~= ARGV[1]", "redis.call('DEL', KEYS[1])");
  }

  private static MockHttpServletRequest callbackRequest(String state) {
    MockHttpServletRequest request =
        new MockHttpServletRequest("GET", "/auth/google/callback");
    request.setCookies(new Cookie(
        RedisOAuth2AuthorizationRequestRepository.COOKIE_NAME, HANDLE));
    request.setParameter("state", state);
    return request;
  }

  private static OAuth2AuthorizationRequest authorizationRequest() {
    return OAuth2AuthorizationRequest.authorizationCode()
        .authorizationUri("https://accounts.google.test/o/oauth2/v2/auth")
        .clientId("client-id")
        .redirectUri("https://auth.example.com/auth/google/callback")
        .scopes(Set.of("openid", "profile", "email"))
        .state(STATE)
        .additionalParameters(Map.of(
            OidcParameterNames.NONCE, "hashed-nonce",
            PkceParameterNames.CODE_CHALLENGE, "code-challenge",
            PkceParameterNames.CODE_CHALLENGE_METHOD, "S256"))
        .attributes(Map.of(
            "registration_id", "google",
            OidcParameterNames.NONCE, "raw-nonce",
            PkceParameterNames.CODE_VERIFIER, "code-verifier"))
        .authorizationRequestUri(
            "https://accounts.google.test/o/oauth2/v2/auth?state=" + STATE)
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
