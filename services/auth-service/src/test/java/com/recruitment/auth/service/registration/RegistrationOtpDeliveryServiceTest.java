package com.recruitment.auth.service.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.recruitment.auth.config.properties.OtpProperties;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.infrastructure.mail.OtpEmailSender;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.DispatchPreflightResult;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.InstallResult;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ResendReservationResult;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore;
import com.recruitment.auth.security.otp.OtpChallengeCodec;
import com.recruitment.auth.security.otp.OtpCodeGenerator;
import com.recruitment.auth.service.registration.RegistrationOtpDeliveryService.DispatchPlan;
import java.time.Duration;
import java.util.Optional;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class RegistrationOtpDeliveryServiceTest {
  private static final String BCRYPT_HASH = "$2a$10$" + "a".repeat(53);
  private static final String EMAIL = "candidate@example.com";
  private static final String EMAIL_KEY = "a".repeat(43);
  private static final String CHALLENGE =
      "v1." + "b".repeat(22) + "." + "c".repeat(43);
  private static final long FENCE = 10L;

  private OtpCodeGenerator codes;
  private OtpChallengeCodec codec;
  private RedisOtpChallengeStore store;
  private OtpEmailSender email;
  private RegistrationOtpDeliveryService service;
  private AuthUser user;

  @BeforeEach
  void setUp() {
    codes = org.mockito.Mockito.mock(OtpCodeGenerator.class);
    codec = org.mockito.Mockito.mock(OtpChallengeCodec.class);
    store = org.mockito.Mockito.mock(RedisOtpChallengeStore.class);
    email = org.mockito.Mockito.mock(OtpEmailSender.class);
    service = new RegistrationOtpDeliveryService(
        codes, codec, store, email, properties());
    user = AuthUser.registerLocal(EMAIL, BCRYPT_HASH, UserRole.CANDIDATE, FENCE);
    when(codec.emailKey(EMAIL)).thenReturn(EMAIL_KEY);
  }

  @Test
  void preflightsPersistsThenEncodesStableUserIdBeforeSending() {
    @SuppressWarnings("unchecked")
    Supplier<AuthUser> persist = org.mockito.Mockito.mock(Supplier.class);
    @SuppressWarnings("unchecked")
    Supplier<AuthUser> current = org.mockito.Mockito.mock(Supplier.class);
    stubHappyRedis();
    when(persist.get()).thenReturn(user);
    when(current.get()).thenReturn(user);

    var result = service.dispatch(
        EMAIL,
        () -> Optional.of(plan(false, persist, current))).orElseThrow();

    assertThat(result.expiresInSeconds()).isEqualTo(300);
    assertThat(result.user()).isSameAs(user);
    InOrder order = inOrder(store, persist, codes, codec, current, email);
    order.verify(store).acquireDispatchLock(eq(EMAIL_KEY), anyString());
    order.verify(store).preflightDispatch(eq(EMAIL_KEY), anyString());
    order.verify(store).renewDispatchLock(eq(EMAIL_KEY), anyString());
    order.verify(persist).get();
    order.verify(store).renewDispatchLock(eq(EMAIL_KEY), anyString());
    order.verify(codes).generate();
    order.verify(codec).encodeRegistration(
        user.getId(), user.getRegistrationId(), EMAIL, "001234");
    order.verify(store).installChallenge(eq(EMAIL_KEY), eq(CHALLENGE), anyString());
    order.verify(current).get();
    order.verify(store).renewDispatchLock(eq(EMAIL_KEY), anyString());
    order.verify(email).sendRegistrationOtp(EMAIL, "001234");
    order.verify(store).renewDispatchLock(eq(EMAIL_KEY), anyString());
    order.verify(current).get();
    order.verify(store).releaseDispatchLock(eq(EMAIL_KEY), anyString());
  }

  @Test
  void redisFailureNeverPreparesOrSendsAnEmail() {
    when(store.acquireDispatchLock(eq(EMAIL_KEY), anyString()))
        .thenThrow(new IllegalStateException("redis down"));

    assertThatThrownBy(() -> service.dispatch(
        EMAIL,
        () -> {
          throw new AssertionError("plan must not be prepared");
        }))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_STORE_UNAVAILABLE");
    verifyNoInteractions(email);
  }

  @Test
  void smtpFailureDeletesOnlyNewChallengeAndRollsBackResend() {
    stubHappyRedis();
    when(store.reserveResend(eq(EMAIL_KEY), anyString()))
        .thenReturn(new ResendReservationResult(true, 2, Duration.ZERO));
    org.mockito.Mockito.doThrow(new IllegalStateException("smtp down"))
        .when(email).sendRegistrationOtp(EMAIL, "001234");

    assertThatThrownBy(() -> service.dispatch(
        EMAIL, () -> Optional.of(plan(true, () -> user, () -> user))))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_EMAIL_UNAVAILABLE");
    verify(store).compareAndDeleteChallenge(EMAIL_KEY, CHALLENGE);
    verify(store).rollbackResendReservation(eq(EMAIL_KEY), anyString());
  }

  @Test
  void resendRateLimitNeverPreflightsPersistsOrSends() {
    when(store.acquireDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(store.reserveResend(eq(EMAIL_KEY), anyString()))
        .thenReturn(new ResendReservationResult(false, 0, Duration.ofSeconds(42)));
    @SuppressWarnings("unchecked")
    Supplier<AuthUser> persist = org.mockito.Mockito.mock(Supplier.class);

    assertThatThrownBy(() -> service.dispatch(
        EMAIL, () -> Optional.of(plan(true, persist, () -> user))))
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("OTP_RESEND_LIMITED");
          assertThat(exception.retryAfterSeconds()).isEqualTo(42);
        });
    verify(store, never()).preflightDispatch(anyString(), anyString());
    verifyNoInteractions(codes, email, persist);
  }

  @Test
  void activeClaimPreflightPreventsDatabaseMutation() {
    when(store.acquireDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(store.reserveResend(eq(EMAIL_KEY), anyString()))
        .thenReturn(new ResendReservationResult(true, 2, Duration.ZERO));
    when(store.preflightDispatch(eq(EMAIL_KEY), anyString()))
        .thenReturn(DispatchPreflightResult.CLAIM_IN_PROGRESS);
    when(store.claimTtl(EMAIL_KEY)).thenReturn(new RedisOtpChallengeStore.KeyTtl(
        RedisOtpChallengeStore.TtlState.EXPIRING,
        Duration.ofSeconds(20)));
    @SuppressWarnings("unchecked")
    Supplier<AuthUser> persist = org.mockito.Mockito.mock(Supplier.class);

    assertThatThrownBy(() -> service.dispatch(
        EMAIL, () -> Optional.of(plan(true, persist, () -> user))))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_VERIFICATION_IN_PROGRESS");
    verifyNoInteractions(persist, codes, email);
    verify(store).rollbackResendReservation(eq(EMAIL_KEY), anyString());
  }

  @Test
  void leaseLostAfterPersistenceNeverGeneratesOrSendsOtp() {
    when(store.acquireDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(store.preflightDispatch(eq(EMAIL_KEY), anyString()))
        .thenReturn(DispatchPreflightResult.READY);
    when(store.renewDispatchLock(eq(EMAIL_KEY), anyString()))
        .thenReturn(true, false);
    @SuppressWarnings("unchecked")
    Supplier<AuthUser> persist = org.mockito.Mockito.mock(Supplier.class);
    when(persist.get()).thenReturn(user);

    assertThatThrownBy(() -> service.dispatch(
        EMAIL, () -> Optional.of(plan(false, persist, () -> user))))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_DISPATCH_IN_PROGRESS");
    verify(persist).get();
    verifyNoInteractions(codes, email);
  }

  @Test
  void leaseLostBeforeSmtpDeletesOnlyItsSnapshotAndDoesNotSend() {
    stubHappyRedis();
    when(store.renewDispatchLock(eq(EMAIL_KEY), anyString()))
        .thenReturn(true, true, false);

    assertThatThrownBy(() -> service.dispatch(
        EMAIL, () -> Optional.of(plan(false, () -> user, () -> user))))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_DISPATCH_IN_PROGRESS");
    verify(store).compareAndDeleteChallenge(EMAIL_KEY, CHALLENGE);
    verify(email, never()).sendRegistrationOtp(anyString(), anyString());
  }

  @Test
  void leaseLostDuringSmtpDoesNotReportSuccessOrDeleteNewerSnapshot() {
    stubHappyRedis();
    when(store.renewDispatchLock(eq(EMAIL_KEY), anyString()))
        .thenReturn(true, true, true, false);
    when(store.compareAndDeleteChallenge(EMAIL_KEY, CHALLENGE)).thenReturn(false);

    assertThatThrownBy(() -> service.dispatch(
        EMAIL, () -> Optional.of(plan(false, () -> user, () -> user))))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_DISPATCH_IN_PROGRESS");
    verify(email).sendRegistrationOtp(EMAIL, "001234");
    verify(store).compareAndDeleteChallenge(EMAIL_KEY, CHALLENGE);
  }

  @Test
  void databaseFailureOccursBeforeChallengeAndRollsBackResend() {
    when(store.acquireDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(store.reserveResend(eq(EMAIL_KEY), anyString()))
        .thenReturn(new ResendReservationResult(true, 2, Duration.ZERO));
    when(store.preflightDispatch(eq(EMAIL_KEY), anyString()))
        .thenReturn(DispatchPreflightResult.READY);
    when(store.renewDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);

    assertThatThrownBy(() -> service.dispatch(
        EMAIL,
        () -> Optional.of(plan(true, () -> {
          throw new AuthBusinessException(
              "ACCOUNT_STORE_UNAVAILABLE",
              "Account service is temporarily unavailable",
              org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE);
        }, () -> user))))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("ACCOUNT_STORE_UNAVAILABLE");
    verify(store, never()).compareAndDeleteChallenge(anyString(), anyString());
    verify(store).rollbackResendReservation(eq(EMAIL_KEY), anyString());
    verifyNoInteractions(codes, email);
  }

  @Test
  void ineligibleFlowOnlyAcquiresAndReleasesLease() {
    when(store.acquireDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);

    assertThat(service.dispatch(EMAIL, Optional::empty)).isEmpty();

    verify(store).releaseDispatchLock(eq(EMAIL_KEY), anyString());
    verify(store, never()).preflightDispatch(anyString(), anyString());
    verifyNoInteractions(codes, email);
  }

  private DispatchPlan plan(
      boolean resend,
      Supplier<AuthUser> persist,
      Supplier<AuthUser> current) {
    return new DispatchPlan(
        user.getRegistrationId(), FENCE, resend, persist, current);
  }

  private void stubHappyRedis() {
    when(store.acquireDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(store.preflightDispatch(eq(EMAIL_KEY), anyString()))
        .thenReturn(DispatchPreflightResult.READY);
    when(store.renewDispatchLock(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(codes.generate()).thenReturn("001234");
    when(codec.encodeRegistration(
        user.getId(), user.getRegistrationId(), EMAIL, "001234"))
        .thenReturn(CHALLENGE);
    when(store.installChallenge(eq(EMAIL_KEY), eq(CHALLENGE), anyString()))
        .thenReturn(InstallResult.INSTALLED);
  }

  private static OtpProperties properties() {
    return new OtpProperties(
        "test-hmac-secret-that-is-at-least-32-bytes",
        Duration.ofMinutes(5),
        Duration.ofMinutes(15),
        5,
        Duration.ofHours(1),
        3,
        Duration.ofSeconds(30),
        Duration.ofSeconds(30));
  }
}
