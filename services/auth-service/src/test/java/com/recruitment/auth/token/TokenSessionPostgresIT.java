package com.recruitment.auth.token;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.RefreshSession;
import com.recruitment.auth.identity.RefreshSessionRepository;
import com.recruitment.auth.identity.RefreshSessionRevocationReason;
import com.recruitment.auth.token.api.AuthTokenResponse;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers
class TokenSessionPostgresIT {
  @Container
  static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
      .withDatabaseName("token_test")
      .withUsername("token_test")
      .withPassword("token_test");

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
        () -> "token-integration-otp-secret-at-least-32-bytes");
    registry.add("auth.token.allow-ephemeral-test-key", () -> "true");
    registry.add("auth.google.enabled", () -> "false");
  }

  @Autowired
  AuthUserRepository users;

  @Autowired
  RefreshSessionRepository sessions;

  @Autowired
  TokenSessionService tokenSessions;

  @Autowired
  JwtDecoder jwtDecoder;

  @Autowired
  RefreshTokenCodec refreshTokens;

  @Autowired
  JdbcTemplate jdbc;

  @BeforeEach
  void cleanDatabase() {
    jdbc.execute("TRUNCATE auth.refresh_sessions, auth.users CASCADE");
  }

  @Test
  void issueRotateAndReusePersistHashLineageAndGlobalRevocation() {
    AuthUser user = users.saveAndFlush(AuthUser.registerOAuth(
        "postgres-token@example.com", Instant.now().minusSeconds(60)));

    AuthTokenResponse issued = tokenSessions.issueForVerifiedUser(user.getId());

    List<RefreshSession> firstGeneration =
        sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId());
    assertThat(firstGeneration).hasSize(1);
    RefreshSession parent = firstGeneration.getFirst();
    assertThat(parent.getTokenHash())
        .isNotEqualTo(issued.refreshToken())
        .matches("^[0-9a-f]{64}$");
    assertThat(issued.refreshToken()).startsWith("rt1_");
    var access = jwtDecoder.decode(issued.accessToken());
    assertThat(access.getSubject()).isEqualTo(user.getId().toString());
    assertThat(access.getClaimAsString("role")).isEqualTo("CANDIDATE");
    assertThat(access.getClaims()).doesNotContainKeys("email", "name", "avatar");

    AuthTokenResponse rotated = tokenSessions.refresh(issued.refreshToken());

    List<RefreshSession> lineage =
        sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId());
    assertThat(lineage).hasSize(2);
    RefreshSession persistedParent = lineage.stream()
        .filter(session -> session.getId().equals(parent.getId()))
        .findFirst()
        .orElseThrow();
    RefreshSession child = lineage.stream()
        .filter(session -> !session.getId().equals(parent.getId()))
        .findFirst()
        .orElseThrow();
    assertThat(persistedParent.getConsumedAt()).isNotNull();
    assertThat(persistedParent.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.ROTATED);
    assertThat(child.getParentSessionId()).isEqualTo(parent.getId());
    assertThat(child.getFamilyId()).isEqualTo(parent.getFamilyId());
    assertThat(child.getExpiresAt()).isEqualTo(parent.getExpiresAt());
    assertThat(child.getTokenHash()).isNotEqualTo(rotated.refreshToken());

    assertThatThrownBy(() -> tokenSessions.refresh(issued.refreshToken()))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception ->
            assertThat(exception.code())
                .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED"));

    RefreshSession revokedWinner = sessions.findById(child.getId()).orElseThrow();
    assertThat(revokedWinner.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.REUSE_DETECTED);
    assertThat(revokedWinner.getRevokedAt()).isNotNull();
  }

  @Test
  void replayingLoggedOutTokenRevokesEveryNewActiveFamily() {
    AuthUser user = users.saveAndFlush(AuthUser.registerOAuth(
        "postgres-logout@example.com", Instant.now().minusSeconds(60)));
    AuthTokenResponse first = tokenSessions.issueForVerifiedUser(user.getId());

    tokenSessions.logout(first.refreshToken());
    AuthTokenResponse second = tokenSessions.issueForVerifiedUser(user.getId());

    assertThatThrownBy(() -> tokenSessions.refresh(first.refreshToken()))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code())
              .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED");
          assertThat(exception.status().value()).isEqualTo(401);
        });

    List<RefreshSession> all = sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId());
    assertThat(all).hasSize(2);
    RefreshSession loggedOut = all.stream()
        .min(Comparator.comparing(RefreshSession::getIssuedAt))
        .orElseThrow();
    RefreshSession newer = all.stream()
        .max(Comparator.comparing(RefreshSession::getIssuedAt))
        .orElseThrow();
    assertThat(loggedOut.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.LOGOUT);
    assertThat(newer.getTokenHash()).isNotEqualTo(second.refreshToken());
    assertThat(newer.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.REUSE_DETECTED);
  }

  @Test
  void expiredLoggedOutTokenCannotRevokeANewerPersistedFamily() {
    AuthUser user = users.saveAndFlush(AuthUser.registerOAuth(
        "postgres-expired-replay@example.com", Instant.now().minusSeconds(9000)));
    Instant now = Instant.now();
    RefreshTokenCodec.Material expiredMaterial = refreshTokens.issue();
    RefreshSession expired = RefreshSession.issue(
        user.getId(),
        expiredMaterial.tokenHash(),
        now.minusSeconds(7200),
        now.minusSeconds(3600));
    expired.revoke(RefreshSessionRevocationReason.LOGOUT, now.minusSeconds(7100));
    sessions.saveAndFlush(expired);
    AuthTokenResponse newerResponse = tokenSessions.issueForVerifiedUser(user.getId());
    String newerHash = refreshTokens.hashPresented(newerResponse.refreshToken()).orElseThrow();

    assertThatThrownBy(() -> tokenSessions.refresh(expiredMaterial.rawToken()))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception ->
            assertThat(exception.code())
                .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED"));

    RefreshSession persistedExpired = sessions.findById(expired.getId()).orElseThrow();
    RefreshSession persistedNewer = sessions.findByTokenHash(newerHash).orElseThrow();
    assertThat(persistedExpired.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.LOGOUT);
    assertThat(persistedNewer.getRevokedAt()).isNull();
    assertThat(persistedNewer.getRevocationReason()).isNull();
  }

  @Test
  void concurrentUseOfOneRefreshTokenRevokesTheWinningChild() throws Exception {
    AuthUser user = users.saveAndFlush(AuthUser.registerOAuth(
        "postgres-concurrent-refresh@example.com", Instant.now().minusSeconds(60)));
    AuthTokenResponse issued = tokenSessions.issueForVerifiedUser(user.getId());
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    java.util.concurrent.Callable<Object> attempt = () -> {
      ready.countDown();
      if (!start.await(5, TimeUnit.SECONDS)) {
        throw new IllegalStateException("concurrent refresh start timed out");
      }
      try {
        return tokenSessions.refresh(issued.refreshToken());
      } catch (AuthBusinessException exception) {
        return exception;
      }
    };

    try {
      Future<Object> first = executor.submit(attempt);
      Future<Object> second = executor.submit(attempt);
      assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      List<Object> outcomes =
          List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));

      assertThat(outcomes)
          .filteredOn(AuthTokenResponse.class::isInstance)
          .hasSize(1);
      AuthBusinessException loser = outcomes.stream()
          .filter(AuthBusinessException.class::isInstance)
          .map(AuthBusinessException.class::cast)
          .findFirst()
          .orElseThrow();
      assertThat(loser.code()).isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED");

      List<RefreshSession> persisted =
          sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId());
      assertThat(persisted).hasSize(2);
      RefreshSession child = persisted.stream()
          .filter(session -> session.getParentSessionId() != null)
          .findFirst()
          .orElseThrow();
      assertThat(child.getRevocationReason())
          .isEqualTo(RefreshSessionRevocationReason.REUSE_DETECTED);
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
  }
}
