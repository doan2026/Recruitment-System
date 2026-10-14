package com.recruitment.auth.service.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.exception.RegistrationVerificationRejectedException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ChallengeInspection;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ChallengeState;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ClaimResult;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ClaimStatus;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore;
import com.recruitment.auth.security.otp.OtpChallengeCodec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class RegistrationOtpVerificationServiceTest {
  private static final String BCRYPT_HASH = "$2a$10$" + "a".repeat(53);
  private static final String EMAIL = "candidate@example.com";
  private static final String EMAIL_KEY = "a".repeat(43);
  private static final String CHALLENGE =
      "v1." + "b".repeat(22) + "." + "c".repeat(43);
  private static final Instant NOW = Instant.parse("2026-08-26T10:00:00Z");
  private static final long FENCE = 10L;

  private RegistrationAccountStore accounts;
  private OtpChallengeCodec codec;
  private RedisOtpChallengeStore store;
  private RegistrationOtpVerificationService service;
  private AuthUser pending;
  private UUID registrationId;

  @BeforeEach
  void setUp() {
    accounts = org.mockito.Mockito.mock(RegistrationAccountStore.class);
    codec = org.mockito.Mockito.mock(OtpChallengeCodec.class);
    store = org.mockito.Mockito.mock(RedisOtpChallengeStore.class);
    service = new RegistrationOtpVerificationService(
        accounts,
        codec,
        store,
        Clock.fixed(NOW, ZoneOffset.UTC));
    pending = AuthUser.registerLocal(EMAIL, BCRYPT_HASH, UserRole.CANDIDATE, FENCE);
    registrationId = pending.getRegistrationId();
    when(codec.emailKey(EMAIL)).thenReturn(EMAIL_KEY);
    when(store.inspectChallenge(EMAIL_KEY)).thenReturn(new ChallengeInspection(
        ChallengeState.READY, CHALLENGE, 0, Duration.ofMinutes(5)));
  }

  @Test
  void claimsThenCommitsAccountBeforeFinalizingChallenge() {
    stubCurrentFlow();
    when(codec.matchesRegistration(
        CHALLENGE, pending.getId(), registrationId, EMAIL, "001234"))
        .thenReturn(true);
    when(store.claimChallenge(
        eq(EMAIL_KEY), eq(CHALLENGE), eq(true), anyString()))
        .thenReturn(new ClaimResult(ClaimStatus.CLAIMED, 0, Duration.ofSeconds(30)));
    when(accounts.verifyPending(EMAIL, pending.getId(), registrationId, FENCE, NOW))
        .thenAnswer(invocation -> {
          pending.verify(NOW);
          return pending;
        });
    when(store.finalizeClaim(eq(EMAIL_KEY), eq(CHALLENGE), anyString())).thenReturn(true);

    AuthUser result = service.verify(pending, registrationId, "001234");

    assertThat(result.isVerified()).isTrue();
    assertThat(result.getRegistrationId()).isNull();
    verify(accounts).verifyPending(EMAIL, pending.getId(), registrationId, FENCE, NOW);
    verify(store).finalizeClaim(eq(EMAIL_KEY), eq(CHALLENGE), anyString());
  }

  @Test
  void registrationIdMismatchIsRejectedBeforeRedis() {
    assertThatThrownBy(() -> service.verify(pending, UUID.randomUUID(), "001234"))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_INVALID_OR_EXPIRED");

    verifyNoInteractions(store);
    verify(accounts, never()).find(anyString());
  }

  @Test
  void supersededFlowIsRejectedBeforeHmacOrClaim() {
    AuthUser superseding = AuthUser.registerLocal(EMAIL, BCRYPT_HASH, UserRole.RECRUITER, FENCE + 1);
    ReflectionTestUtils.setField(superseding, "id", pending.getId());
    when(accounts.find(EMAIL)).thenReturn(Optional.of(superseding));

    assertThatThrownBy(() -> service.verify(pending, registrationId, "001234"))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_INVALID_OR_EXPIRED");

    verify(codec, never()).matchesRegistration(anyString(), any(), any(), anyString(), anyString());
    verify(store, never()).claimChallenge(anyString(), anyString(), anyBoolean(), anyString());
    verify(accounts, never()).verifyPending(anyString(), any(), any(), anyLong(), any());
  }

  @Test
  void activeBlockIsReturnedEvenAfterChallengeWasDeleted() {
    when(store.inspectChallenge(EMAIL_KEY)).thenReturn(new ChallengeInspection(
        ChallengeState.BLOCKED, null, 5, Duration.ofMinutes(15)));

    assertThatThrownBy(() -> service.verify(pending, registrationId, "001234"))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("OTP_VERIFICATION_BLOCKED");
          assertThat(exception.retryAfterSeconds()).isEqualTo(900);
        });
    verify(codec, never()).matchesRegistration(anyString(), any(), any(), anyString(), anyString());
    verify(store, never()).claimChallenge(anyString(), anyString(), anyBoolean(), anyString());
    verify(accounts, never()).find(anyString());
  }

  @Test
  void activeClaimIsRateLimitedBeforeCodeVerification() {
    when(store.inspectChallenge(EMAIL_KEY)).thenReturn(new ChallengeInspection(
        ChallengeState.CLAIM_IN_PROGRESS, null, 0, Duration.ofMillis(1201)));

    assertThatThrownBy(() -> service.verify(pending, registrationId, "001234"))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("OTP_VERIFICATION_IN_PROGRESS");
          assertThat(exception.retryAfterSeconds()).isEqualTo(2);
        });
    verify(codec, never()).matchesRegistration(anyString(), any(), any(), anyString(), anyString());
    verify(store, never()).claimChallenge(anyString(), anyString(), anyBoolean(), anyString());
  }

  @Test
  void wrongOtpMapsToOneSafeErrorAndDoesNotTouchPostgres() {
    stubCurrentFlow();
    when(codec.matchesRegistration(
        CHALLENGE, pending.getId(), registrationId, EMAIL, "999999"))
        .thenReturn(false);
    when(store.claimChallenge(eq(EMAIL_KEY), eq(CHALLENGE), eq(false), anyString()))
        .thenReturn(new ClaimResult(ClaimStatus.INVALID, 1, Duration.ZERO));

    assertThatThrownBy(() -> service.verify(pending, registrationId, "999999"))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_INVALID_OR_EXPIRED");
    verify(accounts, never()).verifyPending(anyString(), any(), any(), anyLong(), any());
  }

  @Test
  void fifthFailureReturnsRateLimitWithRetryAfter() {
    stubCurrentFlow();
    when(codec.matchesRegistration(
        CHALLENGE, pending.getId(), registrationId, EMAIL, "999999"))
        .thenReturn(false);
    when(store.claimChallenge(eq(EMAIL_KEY), eq(CHALLENGE), eq(false), anyString()))
        .thenReturn(new ClaimResult(ClaimStatus.BLOCKED, 5, Duration.ofMinutes(15)));

    assertThatThrownBy(() -> service.verify(pending, registrationId, "999999"))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("OTP_VERIFICATION_BLOCKED");
          assertThat(exception.retryAfterSeconds()).isEqualTo(900);
        });
  }

  @Test
  void rejectedAccountFinalizesClaimInsteadOfReopeningOtp() {
    stubClaimedCode();
    when(accounts.verifyPending(EMAIL, pending.getId(), registrationId, FENCE, NOW))
        .thenThrow(new RegistrationVerificationRejectedException());

    assertThatThrownBy(() -> service.verify(pending, registrationId, "001234"))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_INVALID_OR_EXPIRED");
    verify(store).finalizeClaim(eq(EMAIL_KEY), eq(CHALLENGE), anyString());
    verify(store, never()).releaseClaim(anyString(), anyString());
  }

  @Test
  void ambiguousDatabaseFailureLeavesClaimLeasedInsteadOfReopeningIt() {
    stubClaimedCode();
    when(accounts.verifyPending(EMAIL, pending.getId(), registrationId, FENCE, NOW))
        .thenThrow(new IllegalStateException("ambiguous commit"));

    assertThatThrownBy(() -> service.verify(pending, registrationId, "001234"))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("ACCOUNT_VERIFICATION_UNAVAILABLE");
    verify(store, never()).releaseClaim(anyString(), anyString());
    verify(store, never()).finalizeClaim(eq(EMAIL_KEY), eq(CHALLENGE), anyString());
  }

  private void stubCurrentFlow() {
    when(accounts.find(EMAIL)).thenReturn(Optional.of(pending));
  }

  private void stubClaimedCode() {
    stubCurrentFlow();
    when(codec.matchesRegistration(
        CHALLENGE, pending.getId(), registrationId, EMAIL, "001234"))
        .thenReturn(true);
    when(store.claimChallenge(eq(EMAIL_KEY), eq(CHALLENGE), eq(true), anyString()))
        .thenReturn(new ClaimResult(ClaimStatus.CLAIMED, 0, Duration.ofSeconds(30)));
  }
}
