package com.recruitment.auth.passwordreset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.RefreshSession;
import com.recruitment.auth.identity.RefreshSessionRepository;
import com.recruitment.auth.identity.RefreshSessionRevocationReason;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PasswordResetTransactionsTest {
  private AuthUserRepository users;
  private RefreshSessionRepository sessions;
  private PasswordResetTransactions transactions;

  @BeforeEach
  void setUp() {
    users = org.mockito.Mockito.mock(AuthUserRepository.class);
    sessions = org.mockito.Mockito.mock(RefreshSessionRepository.class);
    transactions = new PasswordResetTransactions(users, sessions);
  }

  @Test
  void changesPasswordAndRevokesOnlyCurrentlyActiveRefreshSessions() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    RefreshSession active = RefreshSession.issue(
        user.getId(),
        "1".repeat(64),
        PasswordResetTestFixtures.NOW.minusSeconds(60),
        PasswordResetTestFixtures.NOW.plusSeconds(3600));
    RefreshSession expired = RefreshSession.issue(
        user.getId(),
        "2".repeat(64),
        PasswordResetTestFixtures.NOW.minusSeconds(7200),
        PasswordResetTestFixtures.NOW.minusSeconds(3600));
    RefreshSession loggedOut = RefreshSession.issue(
        user.getId(),
        "3".repeat(64),
        PasswordResetTestFixtures.NOW.minusSeconds(120),
        PasswordResetTestFixtures.NOW.plusSeconds(3600));
    loggedOut.revoke(
        RefreshSessionRevocationReason.LOGOUT,
        PasswordResetTestFixtures.NOW.minusSeconds(30));
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));
    when(sessions.findAllByUserIdOrderByIssuedAtAsc(user.getId()))
        .thenReturn(List.of(active, expired, loggedOut));

    PasswordResetTransactions.ResetAccount result = transactions.reset(
        user.getId(),
        user.getVersion(),
        PasswordResetTestFixtures.NEXT_HASH,
        PasswordResetTestFixtures.NOW);

    assertThat(result.normalizedEmail()).isEqualTo(PasswordResetTestFixtures.EMAIL);
    assertThat(user.getPasswordHash()).isEqualTo(PasswordResetTestFixtures.NEXT_HASH);
    assertThat(active.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.PASSWORD_RESET);
    assertThat(expired.getRevocationReason()).isNull();
    assertThat(loggedOut.getRevocationReason())
        .isEqualTo(RefreshSessionRevocationReason.LOGOUT);
    verify(sessions).saveAll(List.of(active));
    verify(users).flush();
    verify(sessions).flush();
  }

  @Test
  void staleUserVersionIsRejectedBeforePasswordOrSessionsChange() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    when(users.findByIdForUpdate(user.getId())).thenReturn(Optional.of(user));

    assertThatThrownBy(() -> transactions.reset(
        user.getId(),
        user.getVersion() + 1,
        PasswordResetTestFixtures.NEXT_HASH,
        PasswordResetTestFixtures.NOW))
        .isInstanceOf(PasswordResetRejectedException.class);

    assertThat(user.getPasswordHash()).isEqualTo(PasswordResetTestFixtures.CURRENT_HASH);
    verify(sessions, never()).findAllByUserIdOrderByIssuedAtAsc(user.getId());
    verify(sessions, never()).saveAll(anyList());
  }

  @Test
  void oauthOnlyAndUnverifiedAccountsCannotConsumeAResetBinding() {
    AuthUser oauth = AuthUser.registerOAuth(
        "oauth@example.com",
        PasswordResetTestFixtures.NOW.minusSeconds(60));
    AuthUser unverified = AuthUser.registerLocal(
        "pending@example.com",
        PasswordResetTestFixtures.CURRENT_HASH,
        com.recruitment.auth.identity.UserRole.CANDIDATE);
    when(users.findByIdForUpdate(oauth.getId())).thenReturn(Optional.of(oauth));
    when(users.findByIdForUpdate(unverified.getId())).thenReturn(Optional.of(unverified));

    assertThatThrownBy(() -> transactions.reset(
        oauth.getId(),
        oauth.getVersion(),
        PasswordResetTestFixtures.NEXT_HASH,
        PasswordResetTestFixtures.NOW))
        .isInstanceOf(PasswordResetRejectedException.class);
    assertThatThrownBy(() -> transactions.reset(
        unverified.getId(),
        unverified.getVersion(),
        PasswordResetTestFixtures.NEXT_HASH,
        PasswordResetTestFixtures.NOW))
        .isInstanceOf(PasswordResetRejectedException.class);

    verify(sessions, never()).saveAll(anyList());
  }
}
