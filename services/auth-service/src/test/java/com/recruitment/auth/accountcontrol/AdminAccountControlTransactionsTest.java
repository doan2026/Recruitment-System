package com.recruitment.auth.accountcontrol;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.auth.accountcontrol.AdminAccountControlTransactions.AccountControlResult;
import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.RefreshSessionRepository;
import com.recruitment.auth.identity.RefreshSessionRevocationReason;
import com.recruitment.auth.identity.UserRole;
import java.time.Instant;
import java.time.Clock;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

class AdminAccountControlTransactionsTest {
  private static final Instant NOW = Instant.parse("2026-08-27T08:15:30Z");
  private static final String LOCK_REASON = "Confirmed policy violation";

  private AuthUserRepository users;
  private RefreshSessionRepository sessions;
  private AdminAccountControlTransactions transactions;
  private Clock clock;

  @BeforeEach
  void setUp() {
    users = org.mockito.Mockito.mock(AuthUserRepository.class);
    sessions = org.mockito.Mockito.mock(RefreshSessionRepository.class);
    clock = org.mockito.Mockito.mock(Clock.class);
    when(clock.instant()).thenReturn(NOW);
    transactions = new AdminAccountControlTransactions(users, sessions, clock);
  }

  @Test
  void missingDurableActorIsRejectedBeforeTargetOrSessionsAreInspected() {
    AuthUser target = verifiedUser("target@example.com", UserRole.CANDIDATE);
    when(users.findAllByIdForUpdateOrdered(anyList())).thenReturn(List.of(target));

    assertBusinessError(
        () -> transactions.update(
            java.util.UUID.randomUUID(), target.getId(), true, LOCK_REASON),
        "ACCESS_TOKEN_INVALID",
        HttpStatus.UNAUTHORIZED);

    verifyNoInteractions(sessions);
    assertThat(target.isLocked()).isFalse();
  }

  @Test
  void staleAdminClaimsAreRejectedUsingDurableActorStateBeforeTargetMutation() {
    AuthUser target = verifiedUser("target@example.com", UserRole.CANDIDATE);
    AuthUser nonAdmin = verifiedUser("candidate-actor@example.com", UserRole.CANDIDATE);
    when(users.findAllByIdForUpdateOrdered(anyList()))
        .thenReturn(List.of(nonAdmin, target));

    assertBusinessError(
        () -> transactions.update(
            nonAdmin.getId(), target.getId(), true, LOCK_REASON),
        "ACCESS_DENIED",
        HttpStatus.FORBIDDEN);

    AuthUser lockedAdmin = verifiedAdmin("locked-admin@example.com");
    lockedAdmin.lock("Security review", NOW.minusSeconds(60));
    when(users.findAllByIdForUpdateOrdered(anyList()))
        .thenReturn(List.of(lockedAdmin, target));

    assertBusinessError(
        () -> transactions.update(
            lockedAdmin.getId(), target.getId(), true, LOCK_REASON),
        "ACCESS_DENIED",
        HttpStatus.FORBIDDEN);

    AuthUser pendingAdmin = AuthUser.registerLocal(
        "pending-admin@example.com",
        "$2a$10$" + "a".repeat(53),
        UserRole.CANDIDATE);
    ReflectionTestUtils.setField(pendingAdmin, "role", UserRole.ADMIN);
    when(users.findAllByIdForUpdateOrdered(anyList()))
        .thenReturn(List.of(pendingAdmin, target));

    assertBusinessError(
        () -> transactions.update(
            pendingAdmin.getId(), target.getId(), true, LOCK_REASON),
        "ACCESS_DENIED",
        HttpStatus.FORBIDDEN);

    verifyNoInteractions(sessions);
    assertThat(target.isLocked()).isFalse();
  }

  @Test
  void rejectsSelfControlAndAnyAdminTargetWithoutChangingSessions() {
    AuthUser actor = verifiedAdmin("actor@example.com");
    when(users.findAllByIdForUpdateOrdered(anyList())).thenReturn(List.of(actor));

    assertBusinessError(
        () -> transactions.update(
            actor.getId(), actor.getId(), true, LOCK_REASON),
        "SELF_ACCOUNT_CONTROL_NOT_ALLOWED",
        HttpStatus.CONFLICT);

    AuthUser anotherAdmin = verifiedAdmin("other-admin@example.com");
    when(users.findAllByIdForUpdateOrdered(anyList()))
        .thenReturn(List.of(actor, anotherAdmin));

    assertBusinessError(
        () -> transactions.update(
            actor.getId(), anotherAdmin.getId(), true, LOCK_REASON),
        "ADMIN_ACCOUNT_CONTROL_NOT_ALLOWED",
        HttpStatus.FORBIDDEN);

    verifyNoInteractions(sessions);
    assertThat(actor.isLocked()).isFalse();
    assertThat(anotherAdmin.isLocked()).isFalse();
  }

  @Test
  void authorizedAdminGetsNotFoundOnlyAfterDurableAuthorizationSucceeds() {
    AuthUser actor = verifiedAdmin("actor@example.com");
    java.util.UUID missingTarget = java.util.UUID.randomUUID();
    when(users.findAllByIdForUpdateOrdered(anyList())).thenReturn(List.of(actor));

    assertBusinessError(
        () -> transactions.update(
            actor.getId(), missingTarget, true, LOCK_REASON),
        "AUTH_USER_NOT_FOUND",
        HttpStatus.NOT_FOUND);

    verifyNoInteractions(sessions);
  }

  @Test
  void lockBulkRevokesEveryActiveSessionAndReturnsOnlyMutationMetadata() {
    AuthUser actor = verifiedAdmin("actor@example.com");
    AuthUser target = verifiedUser("target@example.com", UserRole.RECRUITER);
    stubLockedUsers(actor, target);
    when(sessions.revokeActiveByUserId(
        target.getId(), NOW, RefreshSessionRevocationReason.ADMIN_LOCK))
        .thenReturn(2);

    AccountControlResult result = transactions.update(
        actor.getId(), target.getId(), true, LOCK_REASON);

    assertThat(target.isLocked()).isTrue();
    org.mockito.InOrder timestampAfterUserLocks =
        org.mockito.Mockito.inOrder(users, clock, sessions);
    timestampAfterUserLocks.verify(users).findAllByIdForUpdateOrdered(anyList());
    timestampAfterUserLocks.verify(clock).instant();
    timestampAfterUserLocks.verify(sessions).revokeActiveByUserId(
        target.getId(), NOW, RefreshSessionRevocationReason.ADMIN_LOCK);
    assertThat(target.getLockedAt()).isEqualTo(NOW);
    assertThat(target.getLockedReason()).isEqualTo(LOCK_REASON);
    assertThat(result).isEqualTo(
        new AccountControlResult(target.getId(), true, NOW, target.getVersion(), 2));
    verify(users).flush();
    verify(sessions).flush();
  }

  @Test
  void repeatedLockPreservesOriginalReasonAndTimestampButStillEnforcesNoActiveSessions() {
    AuthUser actor = verifiedAdmin("actor@example.com");
    AuthUser target = verifiedUser("target@example.com", UserRole.CANDIDATE);
    Instant originalLockTime = NOW.minusSeconds(3600);
    target.lock("Original evidence", originalLockTime);
    stubLockedUsers(actor, target);
    when(sessions.revokeActiveByUserId(
        target.getId(), NOW, RefreshSessionRevocationReason.ADMIN_LOCK))
        .thenReturn(1);

    AccountControlResult result = transactions.update(
        actor.getId(), target.getId(), true, "Replacement evidence");

    assertThat(target.getLockedReason()).isEqualTo("Original evidence");
    assertThat(target.getLockedAt()).isEqualTo(originalLockTime);
    assertThat(result.lockedAt()).isEqualTo(originalLockTime);
    assertThat(result.revokedSessionCount()).isOne();
  }

  @Test
  void unlockClearsLockStateWithoutInspectingOrRevivingSessionsAndIsIdempotent() {
    AuthUser actor = verifiedAdmin("actor@example.com");
    AuthUser target = verifiedUser("target@example.com", UserRole.CANDIDATE);
    target.lock(LOCK_REASON, NOW.minusSeconds(60));
    stubLockedUsers(actor, target);

    AccountControlResult unlocked = transactions.update(
        actor.getId(), target.getId(), false, null);

    assertThat(unlocked.locked()).isFalse();
    assertThat(unlocked.lockedAt()).isNull();
    assertThat(unlocked.revokedSessionCount()).isZero();
    assertThat(target.isLocked()).isFalse();
    assertThat(target.getLockedReason()).isNull();
    verify(sessions, never()).revokeActiveByUserId(
        target.getId(), NOW, RefreshSessionRevocationReason.ADMIN_LOCK);

    AccountControlResult repeated = transactions.update(
        actor.getId(), target.getId(), false, null);

    assertThat(repeated.locked()).isFalse();
    assertThat(repeated.lockedAt()).isNull();
    assertThat(repeated.revokedSessionCount()).isZero();
  }

  private void stubLockedUsers(AuthUser actor, AuthUser target) {
    when(users.findAllByIdForUpdateOrdered(anyList()))
        .thenReturn(List.of(actor, target));
  }

  private static AuthUser verifiedAdmin(String email) {
    AuthUser user = verifiedUser(email, UserRole.CANDIDATE);
    ReflectionTestUtils.setField(user, "role", UserRole.ADMIN);
    return user;
  }

  private static AuthUser verifiedUser(String email, UserRole role) {
    return AuthUser.registerOAuth(email, role, NOW.minusSeconds(7200));
  }


  private static void assertBusinessError(
      org.assertj.core.api.ThrowableAssert.ThrowingCallable invocation,
      String code,
      HttpStatus status) {
    assertThatThrownBy(invocation)
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo(code);
          assertThat(exception.status()).isEqualTo(status);
        });
  }
}
