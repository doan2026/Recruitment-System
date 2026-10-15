package com.recruitment.auth.service.passwordreset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.infrastructure.mail.PasswordResetEmailSender;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.RefreshSession;
import com.recruitment.auth.model.RefreshSessionRevocationReason;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.jpa.RefreshSessionRepository;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore;
import com.recruitment.auth.security.passwordreset.PasswordResetTokenCodec;
import com.recruitment.auth.service.token.TokenSessionService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.redis.connection.DataType;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
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
@Timeout(60)
class PasswordResetPostgresRedisIT {
  private static final String EMAIL = "candidate@example.com";
  private static final String PENDING_EMAIL = "pending@example.com";
  private static final String OAUTH_EMAIL = "oauth@example.com";
  private static final String MISSING_EMAIL = "missing@example.com";
  private static final String PASSWORD = "candidate1";
  private static final String NEW_PASSWORD = "updated2";
  private static final String OTHER_NEW_PASSWORD = "different3";
  private static final String WRONG_PASSWORD = "definitely-wrong";
  private static final String REDIS_PASSWORD = "password-reset-test-password";

  @Container
  static final PostgreSQLContainer<?> POSTGRES =
      new PostgreSQLContainer<>("postgres:16-alpine")
          .withDatabaseName("password_reset_test")
          .withUsername("password_reset_test")
          .withPassword("password_reset_test");

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
        "password-reset-integration-otp-secret-at-least-32-bytes");
    registry.add("auth.login.hmac-secret", () ->
        "password-reset-integration-login-secret-at-least-32-bytes");
    registry.add("auth.password-reset.hmac-secret", () ->
        "password-reset-integration-hmac-secret-at-least-32-bytes");
    registry.add("auth.password-reset.frontend-reset-uri", () ->
        "http://localhost:3000/reset-password");
    registry.add("auth.token.allow-ephemeral-test-key", () -> "true");
    registry.add("auth.google.enabled", () -> "false");
    registry.add("auth.cors.allowed-origins", () -> "http://localhost:3000");
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

  @Autowired
  PasswordEncoder passwordEncoder;

  @Autowired
  TokenSessionService tokenSessions;

  @Autowired
  PasswordResetTokenCodec resetTokens;

  @Autowired
  RedisPasswordResetStore resetStore;

  @MockBean
  PasswordResetEmailSender emailSender;

  private final BlockingQueue<ResetMail> deliveredMail = new LinkedBlockingQueue<>();

  @BeforeEach
  void cleanState() {
    jdbc.execute("TRUNCATE auth.oauth_accounts, auth.refresh_sessions, auth.users CASCADE");
    redis.execute((RedisCallback<Void>) connection -> {
      connection.serverCommands().flushDb();
      return null;
    });
    deliveredMail.clear();
    reset(emailSender);
    doAnswer(invocation -> {
      deliveredMail.add(new ResetMail(
          invocation.getArgument(0, String.class),
          invocation.getArgument(1, String.class)));
      return null;
    }).when(emailSender).sendPasswordReset(anyString(), anyString());
  }

  @Test
  void forgotIsGenericEligiblePiiFreeExpiringAndSupersedesTheOlderToken()
      throws Exception {
    AuthUser local = verifiedLocal(EMAIL, PASSWORD);
    users.saveAndFlush(AuthUser.registerLocal(
        PENDING_EMAIL,
        passwordEncoder.encode(PASSWORD),
        UserRole.CANDIDATE));
    users.saveAndFlush(AuthUser.registerOAuth(
        OAUTH_EMAIL,
        Instant.now().minusSeconds(60)));

    JsonNode missingResponse = genericForgot(MISSING_EMAIL);
    assertThat(genericForgot(PENDING_EMAIL)).isEqualTo(missingResponse);
    assertThat(genericForgot(OAUTH_EMAIL)).isEqualTo(missingResponse);
    verifyNoInteractions(emailSender);

    JsonNode firstResponse = genericForgot("Candidate@Example.COM");
    ResetMail first = awaitMail();
    JsonNode secondResponse = genericForgot(EMAIL);
    ResetMail second = awaitMail();

    assertThat(firstResponse).isEqualTo(missingResponse);
    assertThat(secondResponse).isEqualTo(missingResponse);
    assertThat(first.recipient()).isEqualTo(EMAIL);
    assertThat(second.recipient()).isEqualTo(EMAIL);
    assertThat(first.rawToken()).matches("pr1_[A-Za-z0-9_-]{43}");
    assertThat(second.rawToken()).matches("pr1_[A-Za-z0-9_-]{43}");
    assertThat(second.rawToken()).isNotEqualTo(first.rawToken());

    String firstDigest = resetTokens.digestPresented(first.rawToken()).orElseThrow();
    String secondDigest = resetTokens.digestPresented(second.rawToken()).orElseThrow();
    Set<String> keys = redis.keys("auth:password-reset:*");
    assertThat(keys).isNotNull().isNotEmpty();
    assertThat(keys).noneMatch(key -> key.contains(firstDigest));
    List<String> currentTokenKeys = keys.stream()
        .filter(key -> key.contains(secondDigest))
        .toList();
    assertThat(currentTokenKeys).hasSize(1);
    assertThat(redis.getExpire(currentTokenKeys.getFirst(), TimeUnit.SECONDS))
        .isBetween(840L, 900L);

    for (String key : keys) {
      assertThat(key)
          .doesNotContain(EMAIL)
          .doesNotContain(PENDING_EMAIL)
          .doesNotContain(OAUTH_EMAIL)
          .doesNotContain(MISSING_EMAIL)
          .doesNotContain("@")
          .doesNotContain(first.rawToken())
          .doesNotContain(second.rawToken())
          .doesNotContain(PASSWORD);
      assertThat(redis.getExpire(key, TimeUnit.MILLISECONDS)).isPositive();
      DataType type = redis.type(key);
      if (type == DataType.STRING) {
        String value = redis.opsForValue().get(key);
        assertThat(value)
            .isNotNull()
            .doesNotContain(EMAIL)
            .doesNotContain("@")
            .doesNotContain(first.rawToken())
            .doesNotContain(second.rawToken())
            .doesNotContain(PASSWORD)
            .doesNotContain(local.getPasswordHash());
      } else if (type == DataType.ZSET) {
        Set<String> members = redis.opsForZSet().range(key, 0, -1);
        assertThat(members).isNotNull().allSatisfy(member ->
            assertThat(member)
                .doesNotContain(EMAIL)
                .doesNotContain("@")
                .doesNotContain(first.rawToken())
                .doesNotContain(second.rawToken()));
      } else {
        throw new AssertionError("unexpected password-reset Redis type: " + type);
      }
    }

    resetPassword(first.rawToken(), NEW_PASSWORD)
        .andExpect(status().isBadRequest())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.code").value("RESET_TOKEN_INVALID_OR_EXPIRED"));
    assertThat(redis.hasKey(currentTokenKeys.getFirst())).isTrue();
  }

  @Test
  void fourthForgotInRollingWindowIsSilentlyLimitedAndKeepsThirdTokenCurrent()
      throws Exception {
    verifiedLocal(EMAIL, PASSWORD);
    ResetMail first = requestResetToken(EMAIL);
    ResetMail second = requestResetToken(EMAIL);
    ResetMail third = requestResetToken(EMAIL);

    genericForgot(EMAIL);
    assertThat(deliveredMail.poll(300, TimeUnit.MILLISECONDS)).isNull();

    resetPassword(first.rawToken(), NEW_PASSWORD)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("RESET_TOKEN_INVALID_OR_EXPIRED"));
    resetPassword(second.rawToken(), NEW_PASSWORD)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("RESET_TOKEN_INVALID_OR_EXPIRED"));
    resetPassword(third.rawToken(), NEW_PASSWORD)
        .andExpect(status().isNoContent());

    String rollbackEmailKey = resetTokens.emailKey("rollback@example.com");
    String firstReservation = UUID.randomUUID().toString();
    String secondReservation = UUID.randomUUID().toString();
    String thirdReservation = UUID.randomUUID().toString();
    String replacementReservation = UUID.randomUUID().toString();
    assertThat(resetStore.reserveRequest(rollbackEmailKey, firstReservation)).isTrue();
    assertThat(resetStore.reserveRequest(rollbackEmailKey, secondReservation)).isTrue();
    assertThat(resetStore.reserveRequest(rollbackEmailKey, thirdReservation)).isTrue();
    assertThat(resetStore.reserveRequest(rollbackEmailKey, replacementReservation)).isFalse();

    assertThat(resetStore.rollbackRequest(rollbackEmailKey, secondReservation)).isTrue();
    assertThat(resetStore.reserveRequest(rollbackEmailKey, replacementReservation)).isTrue();
    assertThat(resetStore.rollbackRequest(rollbackEmailKey, secondReservation)).isFalse();
  }


  @Test
  void validResetChangesBcryptRevokesEveryActiveFamilyAndRejectsReplay()
      throws Exception {
    AuthUser user = verifiedLocal(EMAIL, PASSWORD);
    AuthTokenResponse firstFamily = tokenSessions.issueForVerifiedUser(user.getId());
    AuthTokenResponse rotated = tokenSessions.refresh(firstFamily.refreshToken());
    AuthTokenResponse secondFamily = tokenSessions.issueForVerifiedUser(user.getId());
    ResetMail mail = requestResetToken(EMAIL);

    resetPassword(mail.rawToken(), NEW_PASSWORD)
        .andExpect(status().isNoContent())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(header().string(HttpHeaders.EXPIRES, "0"))
        .andExpect(content().string(""));

    AuthUser changed = users.findById(user.getId()).orElseThrow();
    assertThat(changed.getPasswordHash()).startsWith("$2a$10$");
    assertThat(passwordEncoder.matches(PASSWORD, changed.getPasswordHash())).isFalse();
    assertThat(passwordEncoder.matches(NEW_PASSWORD, changed.getPasswordHash())).isTrue();
    assertThat(changed.getRole()).isEqualTo(UserRole.CANDIDATE);
    assertThat(changed.isVerified()).isTrue();
    assertThat(changed.isLocked()).isFalse();

    List<RefreshSession> persisted =
        sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId());
    assertThat(persisted).hasSize(3);
    RefreshSession rotatedParent = persisted.stream()
        .filter(session ->
            session.getRevocationReason() == RefreshSessionRevocationReason.ROTATED)
        .findFirst()
        .orElseThrow();
    RefreshSession rotatedChild = persisted.stream()
        .filter(session -> rotatedParent.getId().equals(session.getParentSessionId()))
        .findFirst()
        .orElseThrow();
    RefreshSession otherFamily = persisted.stream()
        .filter(session -> session.getParentSessionId() == null)
        .filter(session -> !session.getId().equals(rotatedParent.getId()))
        .findFirst()
        .orElseThrow();
    assertThat(rotatedChild.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.PASSWORD_RESET);
    assertThat(otherFamily.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.PASSWORD_RESET);
    assertThat(rotatedChild.getRevokedAt()).isNotNull();
    assertThat(otherFamily.getRevokedAt()).isNotNull();

    refresh(firstFamily.refreshToken())
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    refresh(rotated.refreshToken())
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    refresh(secondFamily.refreshToken())
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));

    String changedHash = changed.getPasswordHash();
    resetPassword(mail.rawToken(), OTHER_NEW_PASSWORD)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("RESET_TOKEN_INVALID_OR_EXPIRED"));
    assertThat(users.findById(user.getId()).orElseThrow().getPasswordHash())
        .isEqualTo(changedHash);

    login(EMAIL, PASSWORD)
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    login(EMAIL, NEW_PASSWORD)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.accessToken").isString())
        .andExpect(jsonPath("$.data.refreshToken").isString())
        .andExpect(jsonPath("$.data.user.id").value(user.getId().toString()));
  }

  @Test
  void lockedLocalAccountCanResetWithoutLosingItsModerationState() throws Exception {
    AuthUser user = verifiedLocal(EMAIL, PASSWORD);
    Instant lockedAt = Instant.parse("2026-08-26T10:15:30Z");
    String lockedReason = "manual moderation review";
    user.lock(lockedReason, lockedAt);
    users.saveAndFlush(user);
    ResetMail mail = requestResetToken(EMAIL);

    resetPassword(mail.rawToken(), NEW_PASSWORD)
        .andExpect(status().isNoContent())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")));

    AuthUser changed = users.findById(user.getId()).orElseThrow();
    assertThat(passwordEncoder.matches(PASSWORD, changed.getPasswordHash())).isFalse();
    assertThat(passwordEncoder.matches(NEW_PASSWORD, changed.getPasswordHash())).isTrue();
    assertThat(changed.isLocked()).isTrue();
    assertThat(changed.getLockedAt()).isEqualTo(lockedAt);
    assertThat(changed.getLockedReason()).isEqualTo(lockedReason);

    login(EMAIL, NEW_PASSWORD)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"))
        .andExpect(content().string(not(containsString(lockedReason))));
  }

  @Test
  void invalidTokenCannotMutateAndWeakPasswordReleasesClaimForRetry()
      throws Exception {
    AuthUser user = verifiedLocal(EMAIL, PASSWORD);
    AuthTokenResponse session = tokenSessions.issueForVerifiedUser(user.getId());
    String originalHash = user.getPasswordHash();

    resetPassword("not-a-reset-token", NEW_PASSWORD)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("RESET_TOKEN_INVALID_OR_EXPIRED"));
    assertThat(users.findById(user.getId()).orElseThrow().getPasswordHash())
        .isEqualTo(originalHash);
    assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId()))
        .singleElement()
        .satisfies(stored -> assertThat(stored.getRevokedAt()).isNull());

    ResetMail mail = requestResetToken(EMAIL);
    resetPassword(mail.rawToken(), "onlyletters")
        .andExpect(status().isBadRequest())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.code").value("PASSWORD_POLICY_VIOLATION"))
        .andExpect(content().string(not(containsString("onlyletters"))));
    assertThat(users.findById(user.getId()).orElseThrow().getPasswordHash())
        .isEqualTo(originalHash);
    assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId()))
        .singleElement()
        .satisfies(stored -> assertThat(stored.getRevokedAt()).isNull());

    resetPassword(mail.rawToken(), NEW_PASSWORD)
        .andExpect(status().isNoContent());
    AuthUser changed = users.findById(user.getId()).orElseThrow();
    assertThat(passwordEncoder.matches(NEW_PASSWORD, changed.getPasswordHash())).isTrue();
    assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId()))
        .singleElement()
        .satisfies(stored -> assertThat(stored.getRevocationReason())
            .isEqualTo(RefreshSessionRevocationReason.PASSWORD_RESET));
    refresh(session.refreshToken())
        .andExpect(status().isUnauthorized());
  }

  @Test
  void concurrentUseOfOneTokenHasExactlyOnePasswordWinner() throws Exception {
    AuthUser user = verifiedLocal(EMAIL, PASSWORD);
    tokenSessions.issueForVerifiedUser(user.getId());
    ResetMail mail = requestResetToken(EMAIL);
    String digest = resetTokens.digestPresented(mail.rawToken()).orElseThrow();
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(2);

    try {
      Future<ResetOutcome> first = executor.submit(() -> {
        ready.countDown();
        await(start);
        return resetOutcome(mail.rawToken(), NEW_PASSWORD);
      });
      Future<ResetOutcome> second = executor.submit(() -> {
        ready.countDown();
        await(start);
        return resetOutcome(mail.rawToken(), OTHER_NEW_PASSWORD);
      });
      assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
      start.countDown();

      List<ResetOutcome> outcomes = List.of(
          first.get(15, TimeUnit.SECONDS),
          second.get(15, TimeUnit.SECONDS));
      assertThat(outcomes)
          .extracting(ResetOutcome::status)
          .containsExactlyInAnyOrder(204, 400);
      ResetOutcome loser = outcomes.stream()
          .filter(outcome -> outcome.status() == 400)
          .findFirst()
          .orElseThrow();
      assertThat(objectMapper.readTree(loser.body()).path("code").asText())
          .isEqualTo("RESET_TOKEN_INVALID_OR_EXPIRED");

      String storedHash = users.findById(user.getId()).orElseThrow().getPasswordHash();
      boolean firstWon = passwordEncoder.matches(NEW_PASSWORD, storedHash);
      boolean secondWon = passwordEncoder.matches(OTHER_NEW_PASSWORD, storedHash);
      assertThat(firstWon ^ secondWon).isTrue();
      assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId()))
          .singleElement()
          .satisfies(stored -> assertThat(stored.getRevocationReason())
              .isEqualTo(RefreshSessionRevocationReason.PASSWORD_RESET));
      Set<String> keys = redis.keys("auth:password-reset:*");
      assertThat(keys).isNotNull().noneMatch(key -> key.contains(digest));
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void resetRacingRefreshNeverLeavesAUsableSession() throws Exception {
    AuthUser user = verifiedLocal(EMAIL, PASSWORD);
    AuthTokenResponse issued = tokenSessions.issueForVerifiedUser(user.getId());
    ResetMail mail = requestResetToken(EMAIL);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(2);

    try {
      Future<ResetOutcome> resetFuture = executor.submit(() -> {
        ready.countDown();
        await(start);
        return resetOutcome(mail.rawToken(), NEW_PASSWORD);
      });
      Future<RefreshOutcome> refreshFuture = executor.submit(() -> {
        ready.countDown();
        await(start);
        return refreshOutcome(issued.refreshToken());
      });
      assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
      start.countDown();

      ResetOutcome resetOutcome = resetFuture.get(15, TimeUnit.SECONDS);
      RefreshOutcome refreshOutcome = refreshFuture.get(15, TimeUnit.SECONDS);
      assertThat(resetOutcome.status()).isEqualTo(204);
      assertThat(refreshOutcome.status()).isIn(200, 401);
      if (refreshOutcome.status() == 401) {
        assertThat(objectMapper.readTree(refreshOutcome.body()).path("code").asText())
            .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED");
      }

      AuthUser changed = users.findById(user.getId()).orElseThrow();
      assertThat(passwordEncoder.matches(NEW_PASSWORD, changed.getPasswordHash())).isTrue();
      List<RefreshSession> persisted =
          sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId());
      assertThat(persisted)
          .isNotEmpty()
          .noneMatch(session -> session.isUsableAt(Instant.now()))
          .anyMatch(session ->
              session.getRevocationReason() == RefreshSessionRevocationReason.PASSWORD_RESET);

      if (refreshOutcome.status() == 200) {
        assertThat(refreshOutcome.replacementRefreshToken()).isNotBlank();
        assertThat(persisted).hasSize(2);
        RefreshSession child = persisted.stream()
            .filter(session -> session.getParentSessionId() != null)
            .findFirst()
            .orElseThrow();
        assertThat(child.getRevocationReason())
            .isEqualTo(RefreshSessionRevocationReason.PASSWORD_RESET);
        refresh(refreshOutcome.replacementRefreshToken())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
      } else {
        assertThat(refreshOutcome.replacementRefreshToken()).isNull();
        refresh(issued.refreshToken())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
      }
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void successfulResetClearsAnExistingLoginBlock() throws Exception {
    AuthUser user = verifiedLocal(EMAIL, PASSWORD);
    ResetMail mail = requestResetToken(EMAIL);

    for (int attempt = 1; attempt < 5; attempt++) {
      login(EMAIL, WRONG_PASSWORD)
          .andExpect(status().isUnauthorized())
          .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }
    login(EMAIL, WRONG_PASSWORD)
        .andExpect(status().isTooManyRequests())
        .andExpect(header().exists(HttpHeaders.RETRY_AFTER))
        .andExpect(jsonPath("$.code").value("LOGIN_TEMPORARILY_BLOCKED"));
    login(EMAIL, PASSWORD)
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("LOGIN_TEMPORARILY_BLOCKED"));
    Set<String> blockedKeys = redis.keys("auth:login:*");
    assertThat(blockedKeys).isNotNull().hasSize(1);

    resetPassword(mail.rawToken(), NEW_PASSWORD)
        .andExpect(status().isNoContent());
    Set<String> clearedKeys = redis.keys("auth:login:*");
    assertThat(clearedKeys).isNotNull().isEmpty();
    login(EMAIL, NEW_PASSWORD)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.user.id").value(user.getId().toString()));
  }

  private AuthUser verifiedLocal(String email, String password) {
    AuthUser user = AuthUser.registerLocal(
        email,
        passwordEncoder.encode(password),
        UserRole.CANDIDATE);
    user.verify(Instant.now().minusSeconds(60));
    return users.saveAndFlush(user);
  }

  private JsonNode genericForgot(String email) throws Exception {
    MvcResult result = postJson("/auth/forgot-password", Map.of("email", email))
        .andExpect(status().isAccepted())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(header().string(HttpHeaders.EXPIRES, "0"))
        .andExpect(jsonPath("$.data.status").value("RESET_EMAIL_SENT_IF_ELIGIBLE"))
        .andExpect(jsonPath("$.data.expiresInSeconds").value(900))
        .andExpect(jsonPath("$.meta").isMap())
        .andExpect(content().string(not(containsString("pr1_"))))
        .andExpect(content().string(not(containsString(email))))
        .andReturn();
    return objectMapper.readTree(result.getResponse().getContentAsByteArray());
  }

  private ResetMail requestResetToken(String email) throws Exception {
    genericForgot(email);
    ResetMail mail = deliveredMail.poll(5, TimeUnit.SECONDS);
    assertThat(mail).as("password-reset email should be delivered asynchronously").isNotNull();
    return mail;
  }

  private ResetMail awaitMail() throws InterruptedException {
    ResetMail mail = deliveredMail.poll(5, TimeUnit.SECONDS);
    assertThat(mail).as("password-reset email should be delivered asynchronously").isNotNull();
    return mail;
  }

  private ResultActions resetPassword(String token, String newPassword) throws Exception {
    return postJson("/auth/reset-password", Map.of(
        "token", token,
        "newPassword", newPassword));
  }

  private ResultActions login(String email, String password) throws Exception {
    return postJson("/auth/login", Map.of(
        "email", email,
        "password", password));
  }

  private ResultActions refresh(String refreshToken) throws Exception {
    return postJson("/auth/refresh", Map.of("refreshToken", refreshToken));
  }

  private ResultActions postJson(String path, Map<String, ?> body) throws Exception {
    return mvc.perform(post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsBytes(body)));
  }

  private ResetOutcome resetOutcome(String token, String newPassword) {
    try {
      MvcResult result = resetPassword(token, newPassword).andReturn();
      return new ResetOutcome(
          result.getResponse().getStatus(),
          result.getResponse().getContentAsString());
    } catch (Exception exception) {
      throw new IllegalStateException("concurrent reset request failed", exception);
    }
  }

  private RefreshOutcome refreshOutcome(String refreshToken) {
    try {
      MvcResult result = refresh(refreshToken).andReturn();
      int status = result.getResponse().getStatus();
      String body = result.getResponse().getContentAsString();
      String replacement = status == 200
          ? objectMapper.readTree(body).path("data").path("refreshToken").asText()
          : null;
      return new RefreshOutcome(status, body, replacement);
    } catch (Exception exception) {
      throw new IllegalStateException("concurrent refresh request failed", exception);
    }
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS)) {
        throw new IllegalStateException("timed out waiting for reset-test latch");
      }
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("reset-test thread was interrupted", interrupted);
    }
  }

  private record ResetMail(String recipient, String rawToken) {}

  private record ResetOutcome(int status, String body) {}

  private record RefreshOutcome(
      int status,
      String body,
      String replacementRefreshToken) {}
}
