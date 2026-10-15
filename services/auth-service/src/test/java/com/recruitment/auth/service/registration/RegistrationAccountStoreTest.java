package com.recruitment.auth.service.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import com.recruitment.auth.exception.RegistrationVerificationRejectedException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class RegistrationAccountStoreTest {
  private static final String EMAIL = "candidate@example.com";
  private static final String BCRYPT_HASH = "$2a$10$" + "a".repeat(53);
  private static final String NEW_BCRYPT_HASH = "$2a$10$" + "b".repeat(53);

  private AuthUserRepository users;
  private RegistrationAccountStore store;

  @BeforeEach
  void setUp() {
    users = org.mockito.Mockito.mock(AuthUserRepository.class);
    store = new RegistrationAccountStore(users);
  }

  @Test
  void obtainsPositiveMonotonicFenceFromDatabaseSequence() {
    when(users.nextRegistrationFence()).thenReturn(42L);

    assertThat(store.nextRegistrationFence()).isEqualTo(42L);
    verify(users).nextRegistrationFence();
  }

  @Test
  void rejectsBrokenFenceSequenceResult() {
    when(users.nextRegistrationFence()).thenReturn(0L);

    assertThatThrownBy(store::nextRegistrationFence)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("non-positive");
  }

  @Test
  void atomicallyInsertsAFlowBoundPendingAccount() {
    AuthUser draft = AuthUser.registerLocal(
        EMAIL, BCRYPT_HASH, UserRole.CANDIDATE, 10L);
    when(users.upsertPendingRegistration(
        any(), any(), any(), any(), any(), any(), anyLong())).thenReturn(1);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(draft));

    RegistrationAccountStore.RegistrationAccount result = store.upsertPending(draft);

    assertThat(result.accepted()).isTrue();
    assertThat(result.created()).isTrue();
    verify(users).upsertPendingRegistration(
        eq(draft.getId()),
        eq(EMAIL),
        eq(EMAIL),
        eq(BCRYPT_HASH),
        eq("CANDIDATE"),
        eq(draft.getRegistrationId()),
        eq(10L));
  }

  @Test
  void higherFenceSupersedesPendingCredentialsButKeepsStableUserId() {
    UUID existingUserId = UUID.randomUUID();
    AuthUser draft = AuthUser.registerLocal(
        EMAIL, NEW_BCRYPT_HASH, UserRole.RECRUITER, 20L);
    AuthUser stored = AuthUser.registerLocal(
        EMAIL, NEW_BCRYPT_HASH, UserRole.RECRUITER, 20L);
    ReflectionTestUtils.setField(stored, "id", existingUserId);
    ReflectionTestUtils.setField(stored, "registrationId", draft.getRegistrationId());
    when(users.upsertPendingRegistration(
        any(), any(), any(), any(), any(), any(), anyLong())).thenReturn(1);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(stored));

    RegistrationAccountStore.RegistrationAccount result = store.upsertPending(draft);

    assertThat(result.accepted()).isTrue();
    assertThat(result.created()).isFalse();
    assertThat(result.user().getId()).isEqualTo(existingUserId);
    assertThat(result.user().getPasswordHash()).isEqualTo(NEW_BCRYPT_HASH);
    assertThat(result.user().getRole()).isEqualTo(UserRole.RECRUITER);
    assertThat(result.user().getRegistrationId()).isEqualTo(draft.getRegistrationId());
    assertThat(result.user().getRegistrationFence()).isEqualTo(20L);
  }

  @Test
  void staleLowerFenceCannotOverwriteNewerPendingFlow() {
    AuthUser staleDraft = AuthUser.registerLocal(
        EMAIL, BCRYPT_HASH, UserRole.CANDIDATE, 10L);
    AuthUser newer = AuthUser.registerLocal(
        EMAIL, NEW_BCRYPT_HASH, UserRole.RECRUITER, 11L);
    when(users.upsertPendingRegistration(
        any(), any(), any(), any(), any(), any(), anyLong())).thenReturn(0);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(newer));

    RegistrationAccountStore.RegistrationAccount result = store.upsertPending(staleDraft);

    assertThat(result.accepted()).isFalse();
    assertThat(result.user().getRegistrationFence()).isEqualTo(11L);
    assertThat(result.user().getRegistrationId())
        .isNotEqualTo(staleDraft.getRegistrationId());
    assertThat(result.user().getPasswordHash()).isEqualTo(NEW_BCRYPT_HASH);
    assertThat(result.user().getRole()).isEqualTo(UserRole.RECRUITER);
  }

  @Test
  void verifiedConflictCannotBeMutated() {
    AuthUser draft = AuthUser.registerLocal(
        EMAIL, NEW_BCRYPT_HASH, UserRole.RECRUITER, 20L);
    AuthUser verified = AuthUser.registerLocal(
        EMAIL, BCRYPT_HASH, UserRole.CANDIDATE, 10L);
    verified.verify(Instant.parse("2026-08-26T10:00:00Z"));
    when(users.upsertPendingRegistration(
        any(), any(), any(), any(), any(), any(), anyLong())).thenReturn(0);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(verified));

    RegistrationAccountStore.RegistrationAccount result = store.upsertPending(draft);

    assertThat(result.accepted()).isFalse();
    assertThat(result.user().isVerified()).isTrue();
    assertThat(result.user().getPasswordHash()).isEqualTo(BCRYPT_HASH);
    assertThat(result.user().getRole()).isEqualTo(UserRole.CANDIDATE);
  }

  @Test
  void verificationRequiresExpectedUserRegistrationIdAndFence() {
    AuthUser user = AuthUser.registerLocal(
        EMAIL, BCRYPT_HASH, UserRole.CANDIDATE, 10L);
    when(users.findByNormalizedEmailForUpdate(EMAIL)).thenReturn(Optional.of(user));

    assertThatThrownBy(() -> store.verifyPending(
        EMAIL,
        user.getId(),
        user.getRegistrationId(),
        11L,
        Instant.parse("2026-08-26T10:00:00Z")))
        .isInstanceOf(RegistrationVerificationRejectedException.class);
    assertThat(user.isVerified()).isFalse();
  }

  @Test
  void verificationLocksActivatesAndClearsRegistrationFlow() {
    AuthUser user = AuthUser.registerLocal(
        EMAIL, BCRYPT_HASH, UserRole.CANDIDATE, 10L);
    UUID registrationId = user.getRegistrationId();
    Instant verifiedAt = Instant.parse("2026-08-26T10:00:00Z");
    when(users.findByNormalizedEmailForUpdate(EMAIL)).thenReturn(Optional.of(user));

    AuthUser verified = store.verifyPending(
        EMAIL, user.getId(), registrationId, 10L, verifiedAt);

    assertThat(verified.isVerified()).isTrue();
    assertThat(verified.getVerifiedAt()).isEqualTo(verifiedAt);
    assertThat(verified.getRegistrationId()).isNull();
    assertThat(verified.getRegistrationFence()).isEqualTo(10L);
    verify(users).flush();
  }
}
