package com.recruitment.auth.service.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.RefreshSession;
import com.recruitment.auth.model.RefreshSessionRevocationReason;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.jpa.RefreshSessionRepository;
import com.recruitment.auth.repository.redis.login.LoginAttemptLimiter;
import com.recruitment.auth.service.token.TokenSessionService;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Timeout(60)
class AdminAccountControlPostgresIT {
  private static final String ADMIN_PASSWORD = "administrator1";
  private static final String CANDIDATE_PASSWORD = "candidate1";
  private static final String LOCK_REASON = "Confirmed policy violation";
  private static final int BULK_SESSION_COUNT = 20_000;

  @Container
  static final PostgreSQLContainer<?> POSTGRES =
      new PostgreSQLContainer<>("postgres:16-alpine")
          .withDatabaseName("admin_account_control_test")
          .withUsername("admin_account_control_test")
          .withPassword("admin_account_control_test");

  @DynamicPropertySource
  static void configureInfrastructure(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.default-schema", () -> "auth");
    registry.add("spring.flyway.schemas", () -> "auth");
    registry.add("spring.flyway.create-schemas", () -> "true");
    registry.add("spring.jpa.properties.hibernate.default_schema", () -> "auth");
    registry.add("spring.data.redis.repositories.enabled", () -> "false");
    registry.add("auth.otp.hmac-secret", () ->
        "admin-account-control-otp-secret-at-least-32-bytes");
    registry.add("auth.login.hmac-secret", () ->
        "admin-account-control-login-secret-at-least-32-bytes");
    registry.add("auth.password-reset.hmac-secret", () ->
        "admin-account-control-reset-secret-at-least-32-bytes");
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
  AuthUserRepository users;

  @Autowired
  RefreshSessionRepository sessions;

  @Autowired
  PasswordEncoder passwordEncoder;

  @Autowired
  TokenSessionService tokenSessions;

  @MockBean
  LoginAttemptLimiter loginAttempts;

  @BeforeEach
  void cleanState() {
    jdbc.execute("TRUNCATE auth.oauth_accounts, auth.refresh_sessions, auth.users CASCADE");
    reset(loginAttempts);
    when(loginAttempts.preflight(anyString()))
        .thenReturn(LoginAttemptLimiter.AttemptDecision.allowed(0));
    when(loginAttempts.completeSuccessfulCredential(anyString()))
        .thenReturn(LoginAttemptLimiter.AttemptDecision.allowed(0));
    when(loginAttempts.recordFailure(anyString()))
        .thenReturn(LoginAttemptLimiter.AttemptDecision.failed(1));
  }

  @Test
  void directoryPreservesTypedJsonAndLiteralSearchOnPostgres() throws Exception {
    AuthUser admin = insertAdmin("directory-admin@example.com");
    String token = tokenSessions.issueForVerifiedUser(admin.getId()).accessToken();
    AuthUser target = verifiedCandidate("literal%_!@example.com");
    verifiedCandidate("literalxyz@example.com");

    mvc.perform(get("/auth/users")
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
            .param("email", " LITERAL%_! ")
            .param("role", "CANDIDATE")
            .param("locked", "false"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.length()").value(1))
        .andExpect(jsonPath("$.data[0].id").value(target.getId().toString()))
        .andExpect(jsonPath("$.data[0].is_verified").value(true))
        .andExpect(jsonPath("$.data[0].is_locked").value(false))
        .andExpect(jsonPath("$.data[0].created_at").exists())
        .andExpect(jsonPath("$.data[0].password_hash").doesNotExist())
        .andExpect(jsonPath("$.meta.page").value(1))
        .andExpect(jsonPath("$.meta.limit").value(20))
        .andExpect(jsonPath("$.meta.total").value(1));

    mvc.perform(get("/auth/users")
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
            .param("role", "CANDIDATE").param("page", "2").param("limit", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.length()").value(1))
        .andExpect(jsonPath("$.meta.page").value(2))
        .andExpect(jsonPath("$.meta.total").value(2));
  }

  @Test
  void directoryRejectsInvalidPaginationAndRechecksDemotedAdmin() throws Exception {
    AuthUser admin = insertAdmin("directory-demoted-admin@example.com");
    String token = tokenSessions.issueForVerifiedUser(admin.getId()).accessToken();

    mvc.perform(get("/auth/users")
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token).param("limit", "101"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

    jdbc.update("UPDATE auth.users SET role='CANDIDATE' WHERE id=?", admin.getId());
    mvc.perform(get("/auth/users")
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
  }

  @Test
  void endpointRequiresAuthenticationAndAdminRole() throws Exception {
    AuthUser target = verifiedCandidate("authorization-target@example.com");

    accountControl(null, target.getId(), true, LOCK_REASON)
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

    AuthUser candidateActor = verifiedCandidate("candidate-actor@example.com");
    AuthTokenResponse candidateTokens =
        tokenSessions.issueForVerifiedUser(candidateActor.getId());
    accountControl(candidateTokens.accessToken(), target.getId(), true, LOCK_REASON)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

    AuthUser unchanged = users.findById(target.getId()).orElseThrow();
    assertThat(unchanged.isLocked()).isFalse();
    assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(target.getId())).isEmpty();
  }

  @Test
  void lockAndUnlockPersistModerationStateAndKeepSessionAuditImmutable()
      throws Exception {
    AuthUser admin = insertAdmin("moderator@example.com");
    AuthTokenResponse adminTokens = tokenSessions.issueForVerifiedUser(admin.getId());
    AuthUser target = verifiedCandidate("moderated-candidate@example.com");

    AuthTokenResponse firstFamily = tokenSessions.issueForVerifiedUser(target.getId());
    AuthTokenResponse rotated = tokenSessions.refresh(firstFamily.refreshToken());
    AuthTokenResponse loggedOut = tokenSessions.issueForVerifiedUser(target.getId());
    tokenSessions.logout(loggedOut.refreshToken());
    AuthTokenResponse secondActiveFamily =
        tokenSessions.issueForVerifiedUser(target.getId());

    List<RefreshSession> beforeLock =
        sessions.findAllByUserIdOrderByIssuedAtAsc(target.getId());
    assertThat(beforeLock).hasSize(4);
    RefreshSession rotatedAudit = beforeLock.stream()
        .filter(session -> session.getRevocationReason()
            == RefreshSessionRevocationReason.ROTATED)
        .findFirst()
        .orElseThrow();
    RefreshSession logoutAudit = beforeLock.stream()
        .filter(session -> session.getRevocationReason()
            == RefreshSessionRevocationReason.LOGOUT)
        .findFirst()
        .orElseThrow();
    long versionBeforeLock = users.findById(target.getId()).orElseThrow().getVersion();

    accountControl(adminTokens.accessToken(), target.getId(), true, LOCK_REASON)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.userId").value(target.getId().toString()))
        .andExpect(jsonPath("$.data.locked").value(true))
        .andExpect(jsonPath("$.data.lockedAt").isString())
        .andExpect(jsonPath("$.data.version").value(versionBeforeLock + 1))
        .andExpect(jsonPath("$.data.revokedSessionCount").value(2))
        .andExpect(jsonPath("$.meta").isMap())
        .andExpect(content().string(not(containsString(target.getEmail()))))
        .andExpect(content().string(not(containsString(LOCK_REASON))));

    AuthUser locked = users.findById(target.getId()).orElseThrow();
    assertThat(locked.isLocked()).isTrue();
    assertThat(locked.getLockedAt()).isNotNull();
    assertThat(locked.getLockedReason()).isEqualTo(LOCK_REASON);
    assertThat(locked.getVersion()).isEqualTo(versionBeforeLock + 1);

    List<RefreshSession> afterLock =
        sessions.findAllByUserIdOrderByIssuedAtAsc(target.getId());
    assertThat(afterLock).hasSize(4);
    assertThat(afterLock)
        .filteredOn(session -> session.getId().equals(rotatedAudit.getId()))
        .singleElement()
        .satisfies(session -> {
          assertThat(session.getRevocationReason())
              .isEqualTo(RefreshSessionRevocationReason.ROTATED);
          assertThat(session.getRevokedAt()).isEqualTo(rotatedAudit.getRevokedAt());
        });
    assertThat(afterLock)
        .filteredOn(session -> session.getId().equals(logoutAudit.getId()))
        .singleElement()
        .satisfies(session -> {
          assertThat(session.getRevocationReason())
              .isEqualTo(RefreshSessionRevocationReason.LOGOUT);
          assertThat(session.getRevokedAt()).isEqualTo(logoutAudit.getRevokedAt());
        });
    assertThat(afterLock)
        .filteredOn(session -> session.getRevocationReason()
            == RefreshSessionRevocationReason.ADMIN_LOCK)
        .hasSize(2)
        .allSatisfy(session -> assertThat(session.getRevokedAt()).isNotNull());
    assertThat(afterLock)
        .noneMatch(session -> session.isUsableAt(Instant.now()));

    login(target.getEmail(), CANDIDATE_PASSWORD)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"))
        .andExpect(content().string(not(containsString(LOCK_REASON))));
    currentAccount(rotated.accessToken())
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"))
        .andExpect(content().string(not(containsString(LOCK_REASON))));
    refresh(rotated.refreshToken())
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    refresh(secondActiveFamily.refreshToken())
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));

    accountControl(adminTokens.accessToken(), target.getId(), false, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.userId").value(target.getId().toString()))
        .andExpect(jsonPath("$.data.locked").value(false))
        .andExpect(jsonPath("$.data.version").value(versionBeforeLock + 2))
        .andExpect(jsonPath("$.data.revokedSessionCount").value(0))
        .andExpect(content().string(not(containsString(target.getEmail()))))
        .andExpect(content().string(not(containsString(LOCK_REASON))));

    AuthUser unlocked = users.findById(target.getId()).orElseThrow();
    assertThat(unlocked.isLocked()).isFalse();
    assertThat(unlocked.getLockedAt()).isNull();
    assertThat(unlocked.getLockedReason()).isNull();
    assertThat(unlocked.getVersion()).isEqualTo(versionBeforeLock + 2);
    assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(target.getId()))
        .hasSize(4)
        .noneMatch(session -> session.isUsableAt(Instant.now()));
    refresh(secondActiveFamily.refreshToken())
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));

    MvcResult loginResult = login(target.getEmail(), CANDIDATE_PASSWORD)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.accessToken").isString())
        .andExpect(jsonPath("$.data.refreshToken").isString())
        .andReturn();
    JsonNode loginData = objectMapper.readTree(
        loginResult.getResponse().getContentAsByteArray()).path("data");
    assertThat(loginData.path("refreshToken").asText()).startsWith("rt1_");
    assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(target.getId()))
        .hasSize(5)
        .filteredOn(session -> session.isUsableAt(Instant.now()))
        .hasSize(1);
  }

  @Test
  void missingTargetAdminTargetAndStaleLockedAdminActorAreRejected()
      throws Exception {
    AuthUser actor = insertAdmin("actor-admin@example.com");
    AuthTokenResponse actorTokens = tokenSessions.issueForVerifiedUser(actor.getId());
    AuthUser target = verifiedCandidate("stale-actor-target@example.com");

    accountControl(actorTokens.accessToken(), target.getId(), true, null)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.reason").isString());
    accountControl(
            actorTokens.accessToken(), target.getId(), false, "unlock evidence")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.reason").isString());
    accountControl(actorTokens.accessToken(), actor.getId(), true, LOCK_REASON)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code")
            .value("SELF_ACCOUNT_CONTROL_NOT_ALLOWED"));
    assertThat(users.findById(target.getId()).orElseThrow().isLocked()).isFalse();

    accountControl(
            actorTokens.accessToken(), UUID.randomUUID(), true, LOCK_REASON)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("AUTH_USER_NOT_FOUND"));

    AuthUser otherAdmin = insertAdmin("target-admin@example.com");
    accountControl(
            actorTokens.accessToken(), otherAdmin.getId(), true, LOCK_REASON)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code")
            .value("ADMIN_ACCOUNT_CONTROL_NOT_ALLOWED"));
    assertThat(users.findById(otherAdmin.getId()).orElseThrow().isLocked()).isFalse();

    AuthUser persistedActor = users.findById(actor.getId()).orElseThrow();
    persistedActor.lock("Moderator access withdrawn", Instant.now());
    users.saveAndFlush(persistedActor);

    accountControl(actorTokens.accessToken(), target.getId(), true, LOCK_REASON)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    assertThat(users.findById(target.getId()).orElseThrow().isLocked()).isFalse();
  }

  @Test
  void bulkRevokeHandlesLargeFanoutAndRollsBackLockWhenRevocationFails()
      throws Exception {
    AuthUser admin = insertAdmin("bulk-admin@example.com");
    AuthTokenResponse adminTokens = tokenSessions.issueForVerifiedUser(admin.getId());
    AuthUser bulkTarget = verifiedCandidate("bulk-target@example.com");

    int inserted = jdbc.update(
        """
        INSERT INTO auth.refresh_sessions
          (id, user_id, family_id, token_hash, issued_at, expires_at, version)
        SELECT
          md5('bulk-session-' || series)::uuid,
          ?,
          md5('bulk-family-' || series)::uuid,
          md5('bulk-token-left-' || series) || md5('bulk-token-right-' || series),
          CURRENT_TIMESTAMP - INTERVAL '1 hour',
          CURRENT_TIMESTAMP + INTERVAL '1 day',
          0
        FROM generate_series(1, ?) AS series
        """,
        bulkTarget.getId(),
        BULK_SESSION_COUNT);
    assertThat(inserted).isEqualTo(BULK_SESSION_COUNT);

    accountControl(
            adminTokens.accessToken(), bulkTarget.getId(), true, LOCK_REASON)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.locked").value(true))
        .andExpect(jsonPath("$.data.revokedSessionCount")
            .value(BULK_SESSION_COUNT));

    Integer activeAfterBulk = jdbc.queryForObject(
        """
        SELECT COUNT(*)
        FROM auth.refresh_sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        """,
        Integer.class,
        bulkTarget.getId());
    Integer bulkRevoked = jdbc.queryForObject(
        """
        SELECT COUNT(*)
        FROM auth.refresh_sessions
        WHERE user_id = ? AND revocation_reason = 'ADMIN_LOCK' AND version = 1
        """,
        Integer.class,
        bulkTarget.getId());
    assertThat(activeAfterBulk).isZero();
    assertThat(bulkRevoked).isEqualTo(BULK_SESSION_COUNT);

    AuthUser rollbackTarget = verifiedCandidate("rollback-target@example.com");
    tokenSessions.issueForVerifiedUser(rollbackTarget.getId());
    jdbc.execute(
        """
        ALTER TABLE auth.refresh_sessions
        ADD CONSTRAINT ck_test_reject_admin_lock
        CHECK (revocation_reason IS DISTINCT FROM 'ADMIN_LOCK') NOT VALID
        """);
    try {
      accountControl(
              adminTokens.accessToken(), rollbackTarget.getId(), true, LOCK_REASON)
          .andExpect(status().isServiceUnavailable())
          .andExpect(jsonPath("$.code").value("ACCOUNT_CONTROL_UNAVAILABLE"))
          .andExpect(content().string(not(containsString(LOCK_REASON))));
    } finally {
      jdbc.execute(
          """
          ALTER TABLE auth.refresh_sessions
          DROP CONSTRAINT IF EXISTS ck_test_reject_admin_lock
          """);
    }

    assertThat(users.findById(rollbackTarget.getId()).orElseThrow().isLocked())
        .isFalse();
    assertThat(sessions.findAllByUserIdOrderByIssuedAtAsc(rollbackTarget.getId()))
        .singleElement()
        .satisfies(session -> {
          assertThat(session.isRevoked()).isFalse();
          assertThat(session.isUsableAt(Instant.now())).isTrue();
          assertThat(session.getVersion()).isZero();
        });
  }

  @Test
  void concurrentLockAndRefreshLeaveNoUsableTargetSession() throws Exception {
    AuthUser admin = insertAdmin("concurrency-admin@example.com");
    AuthTokenResponse adminTokens = tokenSessions.issueForVerifiedUser(admin.getId());
    AuthUser target = verifiedCandidate("concurrency-target@example.com");
    AuthTokenResponse issued = tokenSessions.issueForVerifiedUser(target.getId());
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(2);

    try {
      Future<MvcResult> lockFuture = executor.submit(() -> {
        ready.countDown();
        await(start);
        return accountControl(
                adminTokens.accessToken(), target.getId(), true, LOCK_REASON)
            .andReturn();
      });
      Future<MvcResult> refreshFuture = executor.submit(() -> {
        ready.countDown();
        await(start);
        return refresh(issued.refreshToken()).andReturn();
      });
      assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
      start.countDown();

      MvcResult lockResult = lockFuture.get(15, TimeUnit.SECONDS);
      MvcResult refreshResult = refreshFuture.get(15, TimeUnit.SECONDS);
      assertThat(lockResult.getResponse().getStatus()).isEqualTo(200);
      assertThat(refreshResult.getResponse().getStatus()).isIn(200, 401, 403);

      AuthUser locked = users.findById(target.getId()).orElseThrow();
      assertThat(locked.isLocked()).isTrue();
      List<RefreshSession> persisted =
          sessions.findAllByUserIdOrderByIssuedAtAsc(target.getId());
      assertThat(persisted).isNotEmpty();
      assertThat(persisted)
          .noneMatch(session -> session.isUsableAt(Instant.now()))
          .anyMatch(session -> session.getRevocationReason()
              == RefreshSessionRevocationReason.ADMIN_LOCK);

      if (refreshResult.getResponse().getStatus() == 200) {
        String replacement = objectMapper.readTree(
                refreshResult.getResponse().getContentAsByteArray())
            .path("data")
            .path("refreshToken")
            .asText();
        assertThat(replacement).startsWith("rt1_");
        refresh(replacement)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code")
                .value("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
      }
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
  }

  private AuthUser verifiedCandidate(String email) {
    AuthUser user = AuthUser.registerLocal(
        email,
        passwordEncoder.encode(CANDIDATE_PASSWORD),
        UserRole.CANDIDATE);
    user.verify(Instant.now().minusSeconds(60));
    return users.saveAndFlush(user);
  }

  private AuthUser insertAdmin(String email) {
    UUID id = UUID.randomUUID();
    Instant verifiedAt = Instant.now().minusSeconds(60);
    jdbc.update(
        """
        INSERT INTO auth.users
          (id, email, normalized_email, password_hash, role,
           is_verified, verified_at, is_locked, version)
        VALUES (?, ?, ?, ?, 'ADMIN', TRUE, ?, FALSE, 0)
        """,
        id,
        email,
        email,
        passwordEncoder.encode(ADMIN_PASSWORD),
        Timestamp.from(verifiedAt));
    return users.findById(id).orElseThrow();
  }

  private ResultActions accountControl(
      String accessToken,
      UUID targetId,
      boolean locked,
      String reason) throws Exception {
    Map<String, ?> body = reason == null
        ? Map.of("locked", locked)
        : Map.of("locked", locked, "reason", reason);
    var request = patch("/auth/users/{id}/lock", targetId)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsBytes(body));
    if (accessToken != null) {
      request.header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken);
    }
    return mvc.perform(request);
  }

  private ResultActions login(String email, String password) throws Exception {
    return mvc.perform(post("/auth/login")
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsBytes(Map.of(
            "email", email,
            "password", password))));
  }

  private ResultActions currentAccount(String accessToken) throws Exception {
    return mvc.perform(get("/auth/me")
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken));
  }

  private ResultActions refresh(String refreshToken) throws Exception {
    return mvc.perform(post("/auth/refresh")
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsBytes(Map.of(
            "refreshToken", refreshToken))));
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS)) {
        throw new IllegalStateException("timed out waiting for concurrent test latch");
      }
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("concurrent test interrupted", exception);
    }
  }
}
