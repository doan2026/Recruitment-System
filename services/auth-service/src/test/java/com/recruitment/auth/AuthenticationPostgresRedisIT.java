package com.recruitment.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.SignedJWT;
import com.recruitment.auth.infrastructure.mail.OtpEmailSender;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.RefreshSession;
import com.recruitment.auth.model.RefreshSessionRevocationReason;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.jpa.RefreshSessionRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Timeout(45)
class AuthenticationPostgresRedisIT {
  private static final String ALLOWED_ORIGIN = "http://localhost:3000";
  private static final String EVIL_ORIGIN = "https://evil.example.com";
  private static final String EMAIL = "candidate@example.com";
  private static final String PASSWORD = "candidate1";
  private static final String WRONG_PASSWORD = "definitely-wrong";
  private static final String REDIS_PASSWORD = "authentication-test-password";
  private static final AtomicReference<String> LATEST_OTP = new AtomicReference<>();

  @Container
  static final PostgreSQLContainer<?> POSTGRES =
      new PostgreSQLContainer<>("postgres:16-alpine")
          .withDatabaseName("auth_http_test")
          .withUsername("auth_http_test")
          .withPassword("auth_http_test");

  @Container
  static final GenericContainer<?> REDIS =
      new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
          .withExposedPorts(6379)
          .withCommand("redis-server", "--requirepass", REDIS_PASSWORD);

  @DynamicPropertySource
  static void configureInfrastructure(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.default-schema", () -> "auth");
    registry.add("spring.flyway.schemas", () -> "auth");
    registry.add("spring.flyway.create-schemas", () -> "true");
    registry.add("spring.jpa.properties.hibernate.default_schema", () -> "auth");
    registry.add("spring.data.redis.url", () ->
        "redis://:" + REDIS_PASSWORD + "@" + REDIS.getHost()
            + ":" + REDIS.getMappedPort(6379));
    registry.add("spring.data.redis.connect-timeout", () -> "2s");
    registry.add("spring.data.redis.timeout", () -> "2s");
    registry.add("auth.otp.hmac-secret", () ->
        "authentication-integration-otp-secret-at-least-32-bytes");
    registry.add("auth.login.hmac-secret", () ->
        "authentication-integration-login-secret-at-least-32-bytes");
    registry.add("auth.token.allow-ephemeral-test-key", () -> "true");
    registry.add("auth.google.enabled", () -> "false");
    registry.add("auth.cors.allowed-origins", () -> ALLOWED_ORIGIN);
    registry.add("management.health.mail.enabled", () -> "false");
  }

  @Autowired
  MockMvc mvc;

  @Autowired
  ObjectMapper objectMapper;

  @Autowired
  JdbcTemplate jdbc;

  @Autowired
  StringRedisTemplate redis;

  @Autowired
  AuthUserRepository users;

  @Autowired
  RefreshSessionRepository sessions;

  @MockBean
  OtpEmailSender emailSender;

  @BeforeEach
  void cleanState() {
    jdbc.execute("TRUNCATE auth.oauth_accounts, auth.refresh_sessions, auth.users CASCADE");
    redis.execute((RedisCallback<Void>) connection -> {
      connection.serverCommands().flushDb();
      return null;
    });
    LATEST_OTP.set(null);
    reset(emailSender);
    doAnswer(invocation -> {
      LATEST_OTP.set(invocation.getArgument(1, String.class));
      return null;
    }).when(emailSender).sendRegistrationOtp(anyString(), anyString());
  }

  @Test
  void verifiedLocalUserCanLoginUsePublishedJwtAndReadCurrentAccount() throws Exception {
    TokenPair verification = registerAndVerify();

    MvcResult loginResult = postJson("/auth/login", Map.of(
            "email", "Candidate@Example.COM",
            "password", PASSWORD))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(jsonPath("$.data.tokenType").value("Bearer"))
        .andExpect(jsonPath("$.data.accessTokenExpiresInSeconds").value(900))
        .andExpect(jsonPath("$.data.refreshTokenExpiresInSeconds").isNumber())
        .andExpect(jsonPath("$.data.user.email").value(EMAIL))
        .andExpect(jsonPath("$.data.user.role").value("CANDIDATE"))
        .andExpect(content().string(not(containsString(PASSWORD))))
        .andReturn();
    TokenPair login = tokenPair(loginResult);

    AuthUser user = users.findByNormalizedEmail(EMAIL).orElseThrow();
    List<RefreshSession> persisted = sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId());
    assertThat(persisted).hasSize(2);
    assertThat(persisted)
        .extracting(RefreshSession::getTokenHash)
        .allMatch(hash -> hash.matches("^[0-9a-f]{64}$"))
        .doesNotContain(verification.refreshToken(), login.refreshToken());
    assertThat(jdbc.queryForObject(
        "SELECT count(*) FROM auth.refresh_sessions "
            + "WHERE token_hash IN (?, ?) OR token_hash LIKE 'rt1_%'",
        Integer.class,
        verification.refreshToken(),
        login.refreshToken())).isZero();

    SignedJWT jwt = SignedJWT.parse(login.accessToken());
    assertThat(jwt.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.RS256);
    assertThat(jwt.getHeader().getType()).isEqualTo(JOSEObjectType.JWT);
    assertThat(jwt.getHeader().getKeyID()).isNotBlank();
    assertThat(jwt.getJWTClaimsSet().getIssuer())
        .isEqualTo("https://auth.recruitment.local");
    assertThat(jwt.getJWTClaimsSet().getAudience()).containsExactly("recruitment-api");
    assertThat(jwt.getJWTClaimsSet().getSubject()).isEqualTo(user.getId().toString());
    assertThat(jwt.getJWTClaimsSet().getStringClaim("role")).isEqualTo("CANDIDATE");
    assertThat(jwt.getJWTClaimsSet().getJWTID()).isNotBlank();
    assertThat(jwt.getJWTClaimsSet().getIssueTime()).isNotNull();
    assertThat(jwt.getJWTClaimsSet().getExpirationTime()).isNotNull();
    assertThat(jwt.getJWTClaimsSet().getClaims())
        .doesNotContainKeys("email", "name", "avatar");

    MvcResult jwksResult = mvc.perform(get("/auth/.well-known/jwks.json"))
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("max-age=300")))
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("must-revalidate")))
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("public")))
        .andExpect(jsonPath("$.keys.length()").value(1))
        .andExpect(jsonPath("$.keys[0].kty").value("RSA"))
        .andExpect(jsonPath("$.keys[0].use").value("sig"))
        .andExpect(jsonPath("$.keys[0].alg").value("RS256"))
        .andExpect(jsonPath("$.keys[0].kid").value(jwt.getHeader().getKeyID()))
        .andExpect(jsonPath("$.keys[0].n").isString())
        .andExpect(jsonPath("$.keys[0].e").isString())
        .andReturn();
    JsonNode publishedKey = objectMapper.readTree(
        jwksResult.getResponse().getContentAsByteArray()).path("keys").get(0);
    assertThat(publishedKey.has("d")).isFalse();
    assertThat(publishedKey.has("p")).isFalse();
    assertThat(publishedKey.has("q")).isFalse();
    assertThat(publishedKey.has("dp")).isFalse();
    assertThat(publishedKey.has("dq")).isFalse();
    assertThat(publishedKey.has("qi")).isFalse();
    assertThat(publishedKey.has("oth")).isFalse();

    getMe(login.accessToken())
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.data.id").value(user.getId().toString()))
        .andExpect(jsonPath("$.data.email").value(EMAIL))
        .andExpect(jsonPath("$.data.role").value("CANDIDATE"))
        .andExpect(jsonPath("$.data.verified").value(true));

    getMe(tamperSignature(login.accessToken()))
        .andExpect(status().isUnauthorized())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    getMe("not-a-jwt")
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

    user.lock("integration security check", Instant.now());
    users.saveAndFlush(user);
    getMe(login.accessToken())
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"))
        .andExpect(content().string(not(containsString("integration security check"))));
  }

  @Test
  void fifthWrongPasswordBlocksEvenCorrectCredentialsAndKeysContainNoPii()
      throws Exception {
    registerAndVerify();

    for (int attempt = 1; attempt < 5; attempt++) {
      login(EMAIL, WRONG_PASSWORD)
          .andExpect(status().isUnauthorized())
          .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
          .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    login(EMAIL, WRONG_PASSWORD)
        .andExpect(status().isTooManyRequests())
        .andExpect(header().string(HttpHeaders.RETRY_AFTER, matchesPattern("[1-9][0-9]*")))
        .andExpect(jsonPath("$.code").value("LOGIN_TEMPORARILY_BLOCKED"));
    login(EMAIL, PASSWORD)
        .andExpect(status().isTooManyRequests())
        .andExpect(header().string(HttpHeaders.RETRY_AFTER, matchesPattern("[1-9][0-9]*")))
        .andExpect(jsonPath("$.code").value("LOGIN_TEMPORARILY_BLOCKED"));

    Set<String> keys = redis.keys("auth:login:*");
    assertThat(keys).isNotNull().hasSize(1);
    assertThat(keys).allSatisfy(key ->
        assertThat(key).doesNotContain(EMAIL).doesNotContain("@").doesNotContain(PASSWORD));
    assertThat(keys).allMatch(key -> key.endsWith(":block"));
    assertThat(keys).allSatisfy(key ->
        assertThat(redis.getExpire(key)).isPositive());
    assertThat(keys).allSatisfy(key ->
        assertThat(redis.opsForValue().get(key))
            .doesNotContain(EMAIL)
            .doesNotContain(PASSWORD));
  }

  @Test
  void inconsistentRedisLimiterStateFailsClosedWithoutIssuingTokens() throws Exception {
    registerAndVerify();
    sessions.deleteAll();

    login(EMAIL, WRONG_PASSWORD)
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    Set<String> keys = redis.keys("auth:login:*:fail");
    assertThat(keys).isNotNull().hasSize(1);
    assertThat(redis.persist(keys.iterator().next())).isTrue();

    login(EMAIL, PASSWORD)
        .andExpect(status().isServiceUnavailable())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.code").value("LOGIN_RATE_LIMIT_UNAVAILABLE"));
    assertThat(sessions.count()).isZero();
  }

  @Test
  void refreshRotatesOneFamilyAndParentReplayRevokesTheWinningChild() throws Exception {
    TokenPair first = registerAndVerify();

    MvcResult refreshResult = postJson("/auth/refresh", Map.of(
            "refreshToken", first.refreshToken()))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(jsonPath("$.data.accessToken").isString())
        .andExpect(jsonPath("$.data.refreshToken").isString())
        .andExpect(content().string(not(containsString(first.refreshToken()))))
        .andReturn();
    TokenPair second = tokenPair(refreshResult);
    assertThat(second.refreshToken()).isNotEqualTo(first.refreshToken());

    UUID userId = users.findByNormalizedEmail(EMAIL).orElseThrow().getId();
    List<RefreshSession> lineage = sessions.findAllByUserIdOrderByIssuedAtAsc(userId);
    assertThat(lineage).hasSize(2);
    RefreshSession parent = lineage.stream()
        .filter(session -> session.getParentSessionId() == null)
        .findFirst()
        .orElseThrow();
    RefreshSession child = lineage.stream()
        .filter(session -> session.getParentSessionId() != null)
        .findFirst()
        .orElseThrow();
    assertThat(parent.getConsumedAt()).isNotNull();
    assertThat(parent.getRevocationReason()).isEqualTo(RefreshSessionRevocationReason.ROTATED);
    assertThat(child.getParentSessionId()).isEqualTo(parent.getId());
    assertThat(child.getFamilyId()).isEqualTo(parent.getFamilyId());
    assertThat(child.getExpiresAt()).isEqualTo(parent.getExpiresAt());
    assertThat(child.getTokenHash()).isNotEqualTo(second.refreshToken());

    postJson("/auth/refresh", Map.of("refreshToken", first.refreshToken()))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    postJson("/auth/refresh", Map.of("refreshToken", second.refreshToken()))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    assertThat(sessions.findById(child.getId()).orElseThrow().getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.REUSE_DETECTED);
  }

  @Test
  void corsFilterAllowsExactFrontendAndRejectsUntrustedOrigin() throws Exception {
    mvc.perform(options("/auth/google/exchange")
            .header(HttpHeaders.ORIGIN, ALLOWED_ORIGIN)
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Content-Type"))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED_ORIGIN))
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"))
        .andExpect(header().string(
            HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS,
            "GET,HEAD,POST,OPTIONS"))
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS, "Content-Type"));

    mvc.perform(options("/auth/me")
            .header(HttpHeaders.ORIGIN, ALLOWED_ORIGIN)
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Authorization"))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED_ORIGIN))
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"))
        .andExpect(header().string(
            HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS,
            "GET,HEAD,POST,OPTIONS"))
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS, "Authorization"));

    mvc.perform(options("/auth/me")
            .header(HttpHeaders.ORIGIN, EVIL_ORIGIN)
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Authorization"))
        .andExpect(status().isForbidden())
        .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));

    mvc.perform(get("/auth/me").header(HttpHeaders.ORIGIN, ALLOWED_ORIGIN))
        .andExpect(status().isUnauthorized())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED_ORIGIN))
        .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"))
        .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
  }

  private TokenPair registerAndVerify() throws Exception {
    MvcResult registration = postJson("/auth/register", Map.of(
            "email", EMAIL,
            "password", PASSWORD,
            "role", "CANDIDATE"))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.data.registrationId").isString())
        .andReturn();
    UUID registrationId = UUID.fromString(objectMapper.readTree(
        registration.getResponse().getContentAsByteArray())
        .path("data")
        .path("registrationId")
        .asText());
    String otp = LATEST_OTP.get();
    assertThat(otp).matches("[0-9]{6}");

    MvcResult verification = postJson("/auth/otp/verify", Map.of(
            "email", EMAIL,
            "registrationId", registrationId,
            "otp", otp))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.data.accessToken").isString())
        .andExpect(jsonPath("$.data.refreshToken").isString())
        .andReturn();
    return tokenPair(verification);
  }

  private ResultActions login(String email, String password) throws Exception {
    return postJson("/auth/login", Map.of("email", email, "password", password));
  }

  private ResultActions getMe(String accessToken) throws Exception {
    return mvc.perform(get("/auth/me")
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken));
  }

  private ResultActions postJson(String path, Map<String, ?> body) throws Exception {
    return mvc.perform(post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsBytes(body)));
  }

  private TokenPair tokenPair(MvcResult result) throws Exception {
    JsonNode data = objectMapper.readTree(
        result.getResponse().getContentAsByteArray()).path("data");
    return new TokenPair(
        data.path("accessToken").asText(),
        data.path("refreshToken").asText());
  }

  private static String tamperSignature(String token) {
    String[] parts = token.split("[.]", -1);
    if (parts.length != 3 || parts[2].isEmpty()) {
      throw new IllegalArgumentException("JWT has an invalid compact shape");
    }
    char replacement = parts[2].charAt(0) == 'A' ? 'B' : 'A';
    return parts[0] + "." + parts[1] + "." + replacement + parts[2].substring(1);
  }

  private record TokenPair(String accessToken, String refreshToken) {}
}
