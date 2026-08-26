package com.recruitment.auth.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers
class AuthPersistencePostgresIT {
  private static final String BCRYPT_HASH = "$2a$10$" + "a".repeat(53);
  private static final Instant BASE_TIME = Instant.parse("2026-08-26T10:00:00Z");

  @Container
  static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
      .withDatabaseName("auth_test")
      .withUsername("auth_test")
      .withPassword("auth_test");

  @DynamicPropertySource
  static void configurePostgres(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.default-schema", () -> "auth");
    registry.add("spring.flyway.schemas", () -> "auth");
    registry.add("spring.flyway.create-schemas", () -> "true");
    registry.add("spring.jpa.properties.hibernate.default_schema", () -> "auth");
    registry.add("spring.data.redis.repositories.enabled", () -> "false");
    registry.add(
        "auth.otp.hmac-secret",
        () -> "integration-test-otp-secret-at-least-32-bytes");
  }

  @Autowired
  JdbcTemplate jdbc;

  @Autowired
  AuthUserRepository users;

  @Autowired
  RefreshSessionRepository sessions;

  @Autowired
  OAuthAccountRepository oauthAccounts;

  @Autowired
  PlatformTransactionManager transactionManager;

  @BeforeEach
  void cleanDatabase() {
    jdbc.execute("TRUNCATE auth.oauth_accounts, auth.refresh_sessions, auth.users CASCADE");
  }

  @Test
  void migratesCleanPostgresAndKeepsEphemeralSecretsOutOfTables() {
    List<String> tables = jdbc.queryForList(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'auth'
        """,
        String.class);

    assertThat(Set.copyOf(tables)).contains(
        "users", "refresh_sessions", "oauth_accounts", "flyway_schema_history");
    assertThat(tables).doesNotContain("otp", "otps", "reset_tokens", "one_time_tokens");
    assertThat(jdbc.queryForObject(
        "SELECT COUNT(*) FROM auth.flyway_schema_history WHERE success AND version IN ('1', '2')",
        Integer.class)).isEqualTo(2);
    assertThat(jdbc.queryForObject(
        """
        SELECT COUNT(*)
        FROM information_schema.sequences
        WHERE sequence_schema = 'auth'
          AND sequence_name = 'registration_flow_fence_seq'
        """,
        Integer.class)).isEqualTo(1);
  }

  @Test
  void enforcesNormalizedEmailRoleLockAndOptimisticVersion() {
    AuthUser user = users.saveAndFlush(AuthUser.registerLocal(
        "Candidate@Example.COM", BCRYPT_HASH, UserRole.CANDIDATE, 11));

    assertThat(user.getRegistrationId()).isNotNull();
    assertThat(user.getRegistrationFence()).isEqualTo(11);
    assertThat(users.findByNormalizedEmail("candidate@example.com"))
        .get()
        .extracting(AuthUser::getId)
        .isEqualTo(user.getId());

    assertThatThrownBy(() -> insertUser(
        "CANDIDATE@example.com", "candidate@example.com", "CANDIDATE", false, null, null))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> insertUser(
        "invalid-role@example.com", "invalid-role@example.com", "SUPER_ADMIN", false, null, null))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> insertUser(
        "locked@example.com", "locked@example.com", "CANDIDATE", true, null, "reason"))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> jdbc.update(
        "UPDATE auth.users SET password_hash = ? WHERE id = ?",
        "plaintext-that-is-deliberately-long-enough-to-bypass-a-length-only-check".repeat(2),
        user.getId()))
        .isInstanceOf(DataIntegrityViolationException.class);

    jdbc.update(
        "UPDATE auth.users SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        user.getId());
    user.lock("Concurrent update", BASE_TIME.plusSeconds(10));
    assertThatThrownBy(() -> users.saveAndFlush(user))
        .isInstanceOf(OptimisticLockingFailureException.class);
  }

  @Test
  void storesOnlyRefreshHashAndPreventsForkedOrCrossFamilyRotation() {
    AuthUser user = users.saveAndFlush(AuthUser.registerLocal(
        "session@example.com", BCRYPT_HASH, UserRole.CANDIDATE));
    AuthUser otherUser = users.saveAndFlush(AuthUser.registerLocal(
        "other-session@example.com", BCRYPT_HASH, UserRole.CANDIDATE));
    RefreshSession parent = sessions.saveAndFlush(RefreshSession.issue(
        user.getId(), "a".repeat(64), BASE_TIME, BASE_TIME.plus(7, ChronoUnit.DAYS)));
    RefreshSession child = parent.rotate(
        "b".repeat(64), BASE_TIME.plusSeconds(30), BASE_TIME.plus(8, ChronoUnit.DAYS));
    sessions.saveAndFlush(parent);
    sessions.saveAndFlush(child);

    assertThat(sessions.findAllByFamilyIdOrderByIssuedAtAsc(parent.getFamilyId()))
        .extracting(RefreshSession::getId)
        .containsExactly(parent.getId(), child.getId());
    assertThat(jdbc.queryForObject(
        "SELECT token_hash FROM auth.refresh_sessions WHERE id = ?",
        String.class,
        parent.getId())).isEqualTo("a".repeat(64));

    assertThatThrownBy(() -> insertRefreshChild(
        user.getId(), parent.getFamilyId(), parent.getId(), "c".repeat(64)))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> insertRefreshChild(
        user.getId(), UUID.randomUUID(), child.getId(), "d".repeat(64)))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> insertRefreshChild(
        otherUser.getId(), parent.getFamilyId(), child.getId(), "e".repeat(64)))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> insertRefreshChild(
        user.getId(), UUID.randomUUID(), null, parent.getTokenHash()))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> jdbc.update(
        """
        INSERT INTO auth.refresh_sessions
          (id, user_id, family_id, token_hash, issued_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        UUID.randomUUID(),
        user.getId(),
        UUID.randomUUID(),
        "raw-token",
        Timestamp.from(BASE_TIME),
        Timestamp.from(BASE_TIME.plusSeconds(60))))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> jdbc.update("DELETE FROM auth.users WHERE id = ?", user.getId()))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void enforcesOAuthSubjectUserProviderAndVerifiedEmailConstraints() {
    AuthUser first = users.saveAndFlush(AuthUser.registerOAuth(
        "first@example.com", BASE_TIME));
    AuthUser second = users.saveAndFlush(AuthUser.registerOAuth(
        "second@example.com", BASE_TIME));
    oauthAccounts.saveAndFlush(OAuthAccount.linkGoogle(
        first.getId(), "google-subject", "FIRST@EXAMPLE.COM", true));

    assertThatThrownBy(() -> oauthAccounts.saveAndFlush(OAuthAccount.linkGoogle(
        second.getId(), "google-subject", "second@example.com", true)))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> oauthAccounts.saveAndFlush(OAuthAccount.linkGoogle(
        first.getId(), "different-subject", "first@example.com", true)))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> jdbc.update(
        """
        INSERT INTO auth.oauth_accounts
          (id, user_id, provider, provider_subject, provider_email, provider_email_verified)
        VALUES (?, ?, 'GOOGLE', ?, ?, FALSE)
        """,
        UUID.randomUUID(),
        second.getId(),
        "unverified-subject",
        "second@example.com"))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() -> jdbc.update(
        """
        INSERT INTO auth.oauth_accounts
          (id, user_id, provider, provider_subject, provider_email, provider_email_verified)
        VALUES (?, ?, 'GOOGLE', ?, ?, TRUE)
        """,
        UUID.randomUUID(),
        UUID.randomUUID(),
        "missing-user-subject",
        "missing@example.com"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void userAggregateLockSerializesRefreshSessionMaintenance() throws Exception {
    AuthUser user = users.saveAndFlush(AuthUser.registerLocal(
        "lock-session@example.com", BCRYPT_HASH, UserRole.CANDIDATE));
    CountDownLatch firstHasLock = new CountDownLatch(1);
    CountDownLatch releaseFirst = new CountDownLatch(1);
    CountDownLatch secondStarted = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(2);

    try {
      Future<?> first = executor.submit(() -> new TransactionTemplate(transactionManager)
          .executeWithoutResult(status -> {
            users.findByIdForUpdate(user.getId()).orElseThrow();
            firstHasLock.countDown();
            await(releaseFirst);
          }));
      assertThat(firstHasLock.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> second = executor.submit(() -> new TransactionTemplate(transactionManager)
          .executeWithoutResult(status -> {
            secondStarted.countDown();
            users.findByIdForUpdate(user.getId()).orElseThrow();
          }));
      assertThat(secondStarted.await(5, TimeUnit.SECONDS)).isTrue();
      assertThatThrownBy(() -> second.get(300, TimeUnit.MILLISECONDS))
          .isInstanceOf(TimeoutException.class);

      releaseFirst.countDown();
      first.get(5, TimeUnit.SECONDS);
      second.get(5, TimeUnit.SECONDS);
    } finally {
      releaseFirst.countDown();
      executor.shutdownNow();
    }
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

  private UUID insertUser(
      String email,
      String normalizedEmail,
      String role,
      boolean locked,
      Instant lockedAt,
      String lockedReason) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
        INSERT INTO auth.users
          (id, email, normalized_email, password_hash, role,
           registration_id, registration_fence, is_locked, locked_at, locked_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        id,
        email,
        normalizedEmail,
        BCRYPT_HASH,
        role,
        UUID.randomUUID(),
        1L,
        locked,
        lockedAt == null ? null : Timestamp.from(lockedAt),
        lockedReason);
    return id;
  }

  private void insertRefreshChild(
      UUID userId, UUID familyId, UUID parentSessionId, String tokenHash) {
    Instant issuedAt = BASE_TIME.plusSeconds(60);
    jdbc.update(
        """
        INSERT INTO auth.refresh_sessions
          (id, user_id, family_id, parent_session_id, token_hash, issued_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        UUID.randomUUID(),
        userId,
        familyId,
        parentSessionId,
        tokenHash,
        Timestamp.from(issuedAt),
        Timestamp.from(issuedAt.plus(7, ChronoUnit.DAYS)));
  }
}
