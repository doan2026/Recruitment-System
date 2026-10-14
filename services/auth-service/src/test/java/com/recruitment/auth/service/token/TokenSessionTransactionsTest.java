package com.recruitment.auth.service.token;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.RefreshSession;
import com.recruitment.auth.model.RefreshSessionRevocationReason;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.jpa.RefreshSessionRepository;
import com.recruitment.auth.security.token.JwtTokenService;
import com.recruitment.auth.security.token.RefreshTokenCodec;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TokenSessionTransactionsTest {
  private static final Instant NOW = Instant.parse("2026-08-26T10:00:00Z");
  private static final String PASSWORD_HASH = "$2a$10$" + "a".repeat(53);

  @Mock
  AuthUserRepository users;

  @Mock
  RefreshSessionRepository sessions;

  @Mock
  JwtTokenService jwtTokens;

  @Mock
  TokenTimeSource time;

  private RefreshTokenCodec refreshTokens;
  private TokenSessionTransactions transactions;

  @BeforeEach
  void setUp() {
    refreshTokens = new RefreshTokenCodec(new SecureRandom());
    transactions = new TokenSessionTransactions(
        users, sessions, jwtTokens, refreshTokens, time);
  }

  @Test
  void issueLocksUserStoresOnlyHashAndReturnsSevenDayFamily() {
    when(time.now()).thenReturn(NOW);
    AuthUser user = AuthUser.registerOAuth("candidate@example.com", NOW.minusSeconds(60));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));
    when(sessions.saveAndFlush(any(RefreshSession.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));
    mockAccessToken();

    AuthTokenResponse response = transactions.issueForVerifiedUser(user.getId());

    ArgumentCaptor<RefreshSession> stored = ArgumentCaptor.forClass(RefreshSession.class);
    verify(sessions).saveAndFlush(stored.capture());
    assertThat(response.accessTokenExpiresInSeconds()).isEqualTo(900);
    assertThat(response.refreshTokenExpiresInSeconds()).isEqualTo(604800);
    assertThat(response.user().id()).isEqualTo(user.getId());
    assertThat(response.user().role()).isEqualTo(UserRole.CANDIDATE);
    assertThat(response.refreshToken()).startsWith("rt1_");
    assertThat(stored.getValue().getTokenHash())
        .isEqualTo(refreshTokens.hashPresented(response.refreshToken()).orElseThrow())
        .doesNotContain(response.refreshToken());
    assertThat(stored.getValue().getExpiresAt()).isEqualTo(NOW.plusSeconds(604800));
  }

  @Test
  void passwordIssueRechecksHashAndLockStateUnderUserLockWithoutLeakingReason() {
    AuthUser user = AuthUser.registerLocal(
        "local@example.com", PASSWORD_HASH, UserRole.RECRUITER);
    user.verify(NOW.minusSeconds(60));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));

    assertThatThrownBy(() ->
        transactions.issueForPasswordLogin(user.getId(), "$2a$10$" + "b".repeat(53)))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("INVALID_CREDENTIALS");
          assertThat(exception.status().value()).isEqualTo(401);
          assertThat(exception.details()).isEmpty();
        });
    verify(sessions, never()).saveAndFlush(any());

    user.lock("internal administrative reason", NOW);
    assertThatThrownBy(() ->
        transactions.issueForPasswordLogin(user.getId(), PASSWORD_HASH))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("ACCOUNT_LOCKED");
          assertThat(exception.status().value()).isEqualTo(403);
          assertThat(exception.details()).isEmpty();
          assertThat(exception.getMessage()).doesNotContain("internal administrative reason");
        });
  }

  @Test
  void refreshRotatesUnderUserLockKeepsAbsoluteDeadlineAndCeilsFinalSecond() {
    when(time.now()).thenReturn(NOW);
    AuthUser user = AuthUser.registerOAuth("refresh@example.com", NOW.minusSeconds(120));
    RefreshSession parent = RefreshSession.issue(
        user.getId(), "a".repeat(64), NOW.minusSeconds(60), NOW.plusMillis(500));
    when(sessions.findUserIdByTokenHash(parent.getTokenHash())).thenReturn(Optional.of(user.getId()));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));
    when(sessions.findByTokenHashForUpdate(parent.getTokenHash()))
        .thenReturn(Optional.of(parent));
    when(sessions.saveAllAndFlush(anyList()))
        .thenAnswer(invocation -> invocation.getArgument(0));
    mockAccessToken();

    AuthTokenResponse response =
        transactions.refresh(parent.getTokenHash()).valueOrThrow();

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<RefreshSession>> saved =
        ArgumentCaptor.forClass((Class) List.class);
    verify(sessions).saveAllAndFlush(saved.capture());
    RefreshSession child = saved.getValue().stream()
        .filter(session -> !session.getId().equals(parent.getId()))
        .findFirst()
        .orElseThrow();
    assertThat(parent.getConsumedAt()).isEqualTo(NOW);
    assertThat(parent.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.ROTATED);
    assertThat(child.getFamilyId()).isEqualTo(parent.getFamilyId());
    assertThat(child.getParentSessionId()).isEqualTo(parent.getId());
    assertThat(child.getExpiresAt()).isEqualTo(parent.getExpiresAt());
    assertThat(response.refreshTokenExpiresInSeconds()).isEqualTo(1);

    InOrder locksBeforeMutation = inOrder(sessions, users);
    locksBeforeMutation.verify(sessions).findUserIdByTokenHash(parent.getTokenHash());
    locksBeforeMutation.verify(users).findByIdForUpdate(user.getId());
    locksBeforeMutation.verify(sessions).findByTokenHashForUpdate(parent.getTokenHash());
    locksBeforeMutation.verify(sessions).saveAllAndFlush(anyList());
  }

  @Test
  void reuseRevokesWinningChildBeforeReturningGenericFailure() {
    when(time.now()).thenReturn(NOW);
    AuthUser user = AuthUser.registerOAuth("reuse@example.com", NOW.minusSeconds(120));
    RefreshSession parent = RefreshSession.issue(
        user.getId(), "a".repeat(64), NOW.minusSeconds(60), NOW.plusSeconds(3600));
    RefreshSession winningChild = parent.rotate(
        "b".repeat(64), NOW.minusSeconds(30), parent.getExpiresAt());
    parent.revoke(
        RefreshSessionRevocationReason.ROTATED, NOW.minusSeconds(30));
    when(sessions.findUserIdByTokenHash(parent.getTokenHash())).thenReturn(Optional.of(user.getId()));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));
    when(sessions.findByTokenHashForUpdate(parent.getTokenHash()))
        .thenReturn(Optional.of(parent));
    when(sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId()))
        .thenReturn(List.of(parent, winningChild));
    when(sessions.saveAllAndFlush(anyList()))
        .thenAnswer(invocation -> invocation.getArgument(0));

    TokenTransactionResult<AuthTokenResponse> result =
        transactions.refresh(parent.getTokenHash());

    assertThatThrownBy(result::valueOrThrow)
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code())
              .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED");
          assertThat(exception.status().value()).isEqualTo(401);
          assertThat(exception.details()).isEmpty();
        });
    assertThat(winningChild.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.REUSE_DETECTED);
    assertThat(winningChild.getRevokedAt()).isEqualTo(NOW);
    verify(sessions).saveAllAndFlush(List.of(parent, winningChild));
    verify(jwtTokens, never()).issue(any(), any());
  }

  @Test
  void logoutRevokesExactlyPresentedUsableSession() {
    when(time.now()).thenReturn(NOW);
    AuthUser user = AuthUser.registerOAuth("logout@example.com", NOW.minusSeconds(120));
    RefreshSession current = RefreshSession.issue(
        user.getId(), "c".repeat(64), NOW.minusSeconds(60), NOW.plusSeconds(3600));
    when(sessions.findUserIdByTokenHash(current.getTokenHash())).thenReturn(Optional.of(user.getId()));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));
    when(sessions.findByTokenHashForUpdate(current.getTokenHash()))
        .thenReturn(Optional.of(current));
    when(sessions.saveAndFlush(current)).thenReturn(current);

    TokenTransactionResult<Void> result = transactions.logout(current.getTokenHash());

    assertThat(result.valueOrThrow()).isNull();
    assertThat(current.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.LOGOUT);
    assertThat(current.getRevokedAt()).isEqualTo(NOW);
  }

  @Test
  void expiredLoggedOutTokenCannotRevokeANewerFamilyDuringRefresh() {
    when(time.now()).thenReturn(NOW);
    AuthUser user = AuthUser.registerOAuth("expired-refresh@example.com", NOW.minusSeconds(9000));
    RefreshSession expired = RefreshSession.issue(
        user.getId(), "d".repeat(64), NOW.minusSeconds(7200), NOW.minusSeconds(3600));
    expired.revoke(RefreshSessionRevocationReason.LOGOUT, NOW.minusSeconds(7100));
    RefreshSession newer = RefreshSession.issue(
        user.getId(), "e".repeat(64), NOW.minusSeconds(60), NOW.plusSeconds(3600));
    when(sessions.findUserIdByTokenHash(expired.getTokenHash())).thenReturn(Optional.of(user.getId()));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));
    when(sessions.findByTokenHashForUpdate(expired.getTokenHash()))
        .thenReturn(Optional.of(expired));

    TokenTransactionResult<AuthTokenResponse> result =
        transactions.refresh(expired.getTokenHash());

    assertThatThrownBy(result::valueOrThrow)
        .isInstanceOfSatisfying(AuthBusinessException.class, exception ->
            assertThat(exception.code())
                .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    assertThat(expired.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.LOGOUT);
    assertThat(newer.getRevokedAt()).isNull();
    verify(sessions, never()).findAllByUserIdOrderByIssuedAtAsc(any());
    verify(sessions, never()).saveAllAndFlush(anyList());
  }

  @Test
  void expiredRotatedTokenCannotRevokeANewerFamilyDuringLogout() {
    when(time.now()).thenReturn(NOW);
    AuthUser user = AuthUser.registerOAuth("expired-logout@example.com", NOW.minusSeconds(9000));
    RefreshSession expired = RefreshSession.issue(
        user.getId(), "f".repeat(64), NOW.minusSeconds(7200), NOW.minusSeconds(3600));
    expired.rotate(
        "1".repeat(64), NOW.minusSeconds(7100), expired.getExpiresAt());
    expired.revoke(
        RefreshSessionRevocationReason.ROTATED, NOW.minusSeconds(7100));
    RefreshSession newer = RefreshSession.issue(
        user.getId(), "2".repeat(64), NOW.minusSeconds(60), NOW.plusSeconds(3600));
    when(sessions.findUserIdByTokenHash(expired.getTokenHash())).thenReturn(Optional.of(user.getId()));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));
    when(sessions.findByTokenHashForUpdate(expired.getTokenHash()))
        .thenReturn(Optional.of(expired));

    TokenTransactionResult<Void> result =
        transactions.logout(expired.getTokenHash());

    assertThatThrownBy(result::valueOrThrow)
        .isInstanceOfSatisfying(AuthBusinessException.class, exception ->
            assertThat(exception.code())
                .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    assertThat(expired.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.ROTATED);
    assertThat(newer.getRevokedAt()).isNull();
    verify(sessions, never()).findAllByUserIdOrderByIssuedAtAsc(any());
    verify(sessions, never()).saveAllAndFlush(anyList());
  }

  @Test
  void publicServiceRejectsMalformedRefreshBeforeAnyTransaction() {
    TokenSessionTransactions transactionBoundary =
        org.mockito.Mockito.mock(TokenSessionTransactions.class);
    TokenSessionService service =
        new TokenSessionService(refreshTokens, transactionBoundary);

    assertThatThrownBy(() -> service.refresh("not-a-refresh-token"))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception ->
            assertThat(exception.code())
                .isEqualTo("REFRESH_TOKEN_INVALID_OR_EXPIRED"));
    verifyNoInteractions(transactionBoundary);
  }

  private void mockAccessToken() {
    when(jwtTokens.issue(any(AuthUser.class), any(Instant.class)))
        .thenAnswer(invocation -> {
          Instant issuedAt = invocation.getArgument(1);
          return new JwtTokenService.IssuedAccessToken(
              "signed.access.token", issuedAt.plusSeconds(900));
        });
  }
}
