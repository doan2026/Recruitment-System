package com.recruitment.auth.service.passwordreset;

import com.recruitment.auth.support.PasswordResetTestFixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.recruitment.auth.dto.passwordreset.ForgotPasswordRequest;
import com.recruitment.auth.dto.passwordreset.ForgotPasswordResponse;
import com.recruitment.auth.dto.passwordreset.ResetPasswordRequest;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.exception.LoginAttemptStoreUnavailableException;
import com.recruitment.auth.exception.PasswordResetRejectedException;
import com.recruitment.auth.infrastructure.mail.PasswordResetEmailSender;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.redis.login.LoginAttemptLimiter;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore.Binding;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore.ClaimResult;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore.ClaimStatus;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore.InstallStatus;
import com.recruitment.auth.repository.redis.passwordreset.RedisPasswordResetStore;
import com.recruitment.auth.security.password.RegistrationPasswordPolicy;
import com.recruitment.auth.security.passwordreset.PasswordResetTokenCodec.Material;
import com.recruitment.auth.security.passwordreset.PasswordResetTokenCodec;
import com.recruitment.auth.service.passwordreset.PasswordResetTransactions.ResetAccount;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

class PasswordResetServiceTest {
  private static final String RAW_TOKEN = "pr1_" + "A".repeat(43);
  private static final String TOKEN_DIGEST = "d".repeat(64);
  private static final String EMAIL_KEY = "e".repeat(43);
  private static final String USER_KEY = "u".repeat(43);
  private static final String NEW_PASSWORD = "new-password1";
  private static final UUID USER_ID =
      UUID.fromString("11111111-2222-4333-8444-555555555555");
  private static final Binding BINDING = new Binding(USER_ID, 7);
  private static final Material MATERIAL = new Material(RAW_TOKEN, TOKEN_DIGEST);

  private AuthUserRepository users;
  private PasswordResetTokenCodec tokens;
  private RedisPasswordResetStore store;
  private PasswordResetEmailSender emailSender;
  private RegistrationPasswordPolicy passwordPolicy;
  private PasswordEncoder passwordEncoder;
  private PasswordResetTransactions transactions;
  private LoginAttemptLimiter loginAttempts;
  private AsyncTaskExecutor mailExecutor;
  private PasswordResetService service;

  @BeforeEach
  void setUp() {
    users = org.mockito.Mockito.mock(AuthUserRepository.class);
    tokens = org.mockito.Mockito.mock(PasswordResetTokenCodec.class);
    store = org.mockito.Mockito.mock(RedisPasswordResetStore.class);
    emailSender = org.mockito.Mockito.mock(PasswordResetEmailSender.class);
    passwordPolicy = org.mockito.Mockito.mock(RegistrationPasswordPolicy.class);
    passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    transactions = org.mockito.Mockito.mock(PasswordResetTransactions.class);
    loginAttempts = org.mockito.Mockito.mock(LoginAttemptLimiter.class);
    mailExecutor = org.mockito.Mockito.mock(AsyncTaskExecutor.class);
    doAnswer(invocation -> {
      invocation.<Runnable>getArgument(0).run();
      return null;
    }).when(mailExecutor).execute(any(Runnable.class));
    service = new PasswordResetService(
        users,
        tokens,
        store,
        emailSender,
        PasswordResetTestFixtures.properties(),
        passwordPolicy,
        passwordEncoder,
        transactions,
        loginAttempts,
        mailExecutor,
        Clock.fixed(PasswordResetTestFixtures.NOW, ZoneOffset.UTC));
  }

  @Test
  void eligibleForgotInstallsLatestChallengeAndDispatchesOnlyRawToken() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    stubForgotQuota();
    when(users.findByNormalizedEmail(PasswordResetTestFixtures.EMAIL))
        .thenReturn(Optional.of(user));
    when(tokens.issue()).thenReturn(MATERIAL);
    when(tokens.userKey(user.getId())).thenReturn(USER_KEY);
    Binding expectedBinding = new Binding(user.getId(), user.getVersion());
    when(store.install(TOKEN_DIGEST, USER_KEY, expectedBinding))
        .thenReturn(InstallStatus.INSTALLED);
    when(store.acquireDelivery(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(expectedBinding), anyString()))
        .thenReturn(true);
    when(store.releaseDelivery(eq(TOKEN_DIGEST), anyString())).thenReturn(true);

    ForgotPasswordResponse response = service.forgot(
        new ForgotPasswordRequest(" Candidate@Example.COM "));

    assertGenericForgot(response);
    verify(store).reserveRequest(eq(EMAIL_KEY), anyString());
    verify(store).install(TOKEN_DIGEST, USER_KEY, expectedBinding);
    verify(emailSender).sendPasswordReset(PasswordResetTestFixtures.EMAIL, RAW_TOKEN);
    InOrder delivery = inOrder(store, emailSender);
    delivery.verify(store).acquireDelivery(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(expectedBinding), anyString());
    delivery.verify(emailSender)
        .sendPasswordReset(PasswordResetTestFixtures.EMAIL, RAW_TOKEN);
    delivery.verify(store).releaseDelivery(eq(TOKEN_DIGEST), anyString());
    verify(store, never()).rollbackRequest(anyString(), anyString());
  }

  @Test
  void missingAccountAndQuotaExhaustionReturnIndistinguishableResponses() {
    when(tokens.emailKey(PasswordResetTestFixtures.EMAIL)).thenReturn(EMAIL_KEY);
    when(store.reserveRequest(eq(EMAIL_KEY), anyString()))
        .thenReturn(true, false);
    when(users.findByNormalizedEmail(PasswordResetTestFixtures.EMAIL))
        .thenReturn(Optional.empty());

    ForgotPasswordResponse missing = service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL));
    ForgotPasswordResponse throttled = service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL));

    assertThat(throttled).isEqualTo(missing);
    assertGenericForgot(missing);
    verify(users).findByNormalizedEmail(PasswordResetTestFixtures.EMAIL);
    verify(tokens, never()).issue();
    verifyNoInteractions(emailSender);
    verify(store, never()).rollbackRequest(anyString(), anyString());
  }

  @Test
  void oauthOnlyAndUnverifiedAccountsNeverReceiveResetEmail() {
    AuthUser oauth = AuthUser.registerOAuth(
        PasswordResetTestFixtures.EMAIL, PasswordResetTestFixtures.NOW);
    AuthUser unverified = com.recruitment.auth.model.AuthUser.registerLocal(
        "pending@example.com",
        PasswordResetTestFixtures.CURRENT_HASH,
        com.recruitment.auth.model.UserRole.CANDIDATE);
    when(tokens.emailKey(anyString())).thenReturn(EMAIL_KEY);
    when(store.reserveRequest(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(users.findByNormalizedEmail(PasswordResetTestFixtures.EMAIL))
        .thenReturn(Optional.of(oauth));
    when(users.findByNormalizedEmail("pending@example.com"))
        .thenReturn(Optional.of(unverified));

    assertGenericForgot(service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));
    assertGenericForgot(service.forgot(
        new ForgotPasswordRequest("pending@example.com")));

    verify(tokens, never()).issue();
    verifyNoInteractions(emailSender);
    verify(store, never()).rollbackRequest(anyString(), anyString());
  }

  @Test
  void forgotFailsClosedWhenQuotaStoreOrAccountStoreIsUnavailable() {
    when(tokens.emailKey(PasswordResetTestFixtures.EMAIL)).thenReturn(EMAIL_KEY);
    when(store.reserveRequest(eq(EMAIL_KEY), anyString()))
        .thenThrow(new DataAccessResourceFailureException("redis offline"));

    assertUnavailable(() -> service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));
    verify(users, never()).findByNormalizedEmail(anyString());

    org.mockito.Mockito.reset(store);
    when(store.reserveRequest(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(store.rollbackRequest(eq(EMAIL_KEY), anyString())).thenReturn(true);
    when(users.findByNormalizedEmail(PasswordResetTestFixtures.EMAIL))
        .thenThrow(new DataAccessResourceFailureException("database offline"));

    assertUnavailable(() -> service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));
    ArgumentCaptor<String> reservation = ArgumentCaptor.forClass(String.class);
    verify(store).reserveRequest(eq(EMAIL_KEY), reservation.capture());
    verify(store).rollbackRequest(EMAIL_KEY, reservation.getValue());
    verify(tokens, never()).issue();
  }

  @Test
  void installFailureRollsBackExactReservationAndKeepsGenericResponse() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    stubForgotQuota();
    when(users.findByNormalizedEmail(PasswordResetTestFixtures.EMAIL))
        .thenReturn(Optional.of(user));
    when(tokens.issue()).thenReturn(MATERIAL);
    when(tokens.userKey(user.getId())).thenReturn(USER_KEY);
    Binding binding = new Binding(user.getId(), user.getVersion());
    when(store.install(TOKEN_DIGEST, USER_KEY, binding))
        .thenThrow(new DataAccessResourceFailureException("redis install failed"));
    when(store.rollbackRequest(eq(EMAIL_KEY), anyString()))
        .thenThrow(new DataAccessResourceFailureException("redis rollback failed"));

    assertGenericForgot(service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));

    ArgumentCaptor<String> reservation = ArgumentCaptor.forClass(String.class);
    verify(store).reserveRequest(eq(EMAIL_KEY), reservation.capture());
    verify(store).rollbackRequest(EMAIL_KEY, reservation.getValue());
    verify(mailExecutor, never()).execute(any(Runnable.class));
  }

  @Test
  void activeClaimReplacementLimitKeepsQuotaConsumed() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    stubForgotQuota();
    when(users.findByNormalizedEmail(PasswordResetTestFixtures.EMAIL))
        .thenReturn(Optional.of(user));
    when(tokens.issue()).thenReturn(MATERIAL);
    when(tokens.userKey(user.getId())).thenReturn(USER_KEY);
    Binding binding = new Binding(user.getId(), user.getVersion());
    when(store.install(TOKEN_DIGEST, USER_KEY, binding))
        .thenReturn(InstallStatus.CLAIM_IN_PROGRESS);

    assertGenericForgot(service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));

    verify(store, never()).rollbackRequest(anyString(), anyString());
    verify(mailExecutor, never()).execute(any(Runnable.class));
  }

  @Test
  void smtpFailureReleasesDeliveryLeaseAndCasDiscardsChallenge() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    Binding binding = stubEligibleForgot(user);
    when(store.acquireDelivery(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(binding), anyString()))
        .thenReturn(true);
    when(store.releaseDelivery(eq(TOKEN_DIGEST), anyString())).thenReturn(true);
    when(store.discardUnclaimed(TOKEN_DIGEST, USER_KEY, binding)).thenReturn(true);
    doThrow(new IllegalStateException("smtp offline"))
        .when(emailSender)
        .sendPasswordReset(PasswordResetTestFixtures.EMAIL, RAW_TOKEN);

    assertGenericForgot(service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));

    InOrder cleanup = inOrder(emailSender, store);
    cleanup.verify(emailSender)
        .sendPasswordReset(PasswordResetTestFixtures.EMAIL, RAW_TOKEN);
    cleanup.verify(store).releaseDelivery(eq(TOKEN_DIGEST), anyString());
    cleanup.verify(store).discardUnclaimed(TOKEN_DIGEST, USER_KEY, binding);
    verify(store, never()).rollbackRequest(anyString(), anyString());
  }

  @Test
  void supersededChallengeIsNotEmailedAndKeepsQuotaConsumed() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    Binding binding = stubEligibleForgot(user);
    when(store.acquireDelivery(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(binding), anyString()))
        .thenReturn(false);

    assertGenericForgot(service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));

    verifyNoInteractions(emailSender);
    verify(store, never()).releaseDelivery(anyString(), anyString());
    verify(store, never()).rollbackRequest(anyString(), anyString());
  }

  @Test
  void rejectedExecutorDiscardsChallengeAndRollsBackExactReservation() {
    AuthUser user = PasswordResetTestFixtures.verifiedLocal();
    Binding binding = stubEligibleForgot(user);
    org.mockito.Mockito.reset(mailExecutor);
    doThrow(new TaskRejectedException("queue full"))
        .when(mailExecutor).execute(any(Runnable.class));
    when(store.discardUnclaimed(TOKEN_DIGEST, USER_KEY, binding)).thenReturn(true);
    when(store.rollbackRequest(eq(EMAIL_KEY), anyString())).thenReturn(true);

    assertGenericForgot(service.forgot(
        new ForgotPasswordRequest(PasswordResetTestFixtures.EMAIL)));

    ArgumentCaptor<String> reservation = ArgumentCaptor.forClass(String.class);
    verify(store).reserveRequest(eq(EMAIL_KEY), reservation.capture());
    verify(store).discardUnclaimed(TOKEN_DIGEST, USER_KEY, binding);
    verify(store).rollbackRequest(EMAIL_KEY, reservation.getValue());
    verifyNoInteractions(emailSender);
  }

  @Test
  void resetClaimsBeforeValidationAndFinalizesAfterCommittedPasswordChange() {
    stubClaimedReset();
    when(passwordEncoder.encode(NEW_PASSWORD))
        .thenReturn(PasswordResetTestFixtures.NEXT_HASH);
    when(transactions.reset(
        USER_ID,
        BINDING.userVersion(),
        PasswordResetTestFixtures.NEXT_HASH,
        PasswordResetTestFixtures.NOW))
        .thenReturn(new ResetAccount(PasswordResetTestFixtures.EMAIL));
    when(store.finalizeClaim(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(BINDING), anyString()))
        .thenReturn(true);

    service.reset(new ResetPasswordRequest(RAW_TOKEN, NEW_PASSWORD));

    InOrder order = inOrder(store, passwordPolicy, passwordEncoder, transactions, loginAttempts);
    order.verify(store).claim(eq(TOKEN_DIGEST), anyString());
    order.verify(passwordPolicy).validate(NEW_PASSWORD);
    order.verify(passwordEncoder).encode(NEW_PASSWORD);
    order.verify(transactions).reset(
        USER_ID,
        BINDING.userVersion(),
        PasswordResetTestFixtures.NEXT_HASH,
        PasswordResetTestFixtures.NOW);
    order.verify(store).finalizeClaim(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(BINDING), anyString());
    order.verify(loginAttempts)
        .clearAfterPasswordReset(PasswordResetTestFixtures.EMAIL);
  }

  @Test
  void malformedMissingAndInProgressTokensShareOneGenericError() {
    when(tokens.digestPresented("malformed")).thenReturn(Optional.empty());
    AuthBusinessException malformed = captureBusiness(
        () -> service.reset(new ResetPasswordRequest("malformed", NEW_PASSWORD)));

    when(tokens.digestPresented(RAW_TOKEN)).thenReturn(Optional.of(TOKEN_DIGEST));
    when(store.claim(eq(TOKEN_DIGEST), anyString()))
        .thenReturn(new ClaimResult(ClaimStatus.MISSING, null, Duration.ZERO))
        .thenReturn(new ClaimResult(
            ClaimStatus.IN_PROGRESS, null, Duration.ofSeconds(10)));
    AuthBusinessException missing = captureBusiness(
        () -> service.reset(new ResetPasswordRequest(RAW_TOKEN, NEW_PASSWORD)));
    AuthBusinessException inProgress = captureBusiness(
        () -> service.reset(new ResetPasswordRequest(RAW_TOKEN, NEW_PASSWORD)));

    assertInvalidReset(malformed);
    assertInvalidReset(missing);
    assertInvalidReset(inProgress);
    verifyNoInteractions(passwordPolicy, transactions);
  }

  @Test
  void passwordPolicyFailureRecoversClaimWithoutHashingOrWriting() {
    stubClaimedReset();
    AuthBusinessException policyError = new AuthBusinessException(
        "PASSWORD_POLICY_VIOLATION", "weak", HttpStatus.BAD_REQUEST);
    doThrow(policyError).when(passwordPolicy).validate(NEW_PASSWORD);
    when(store.recoverClaim(eq(TOKEN_DIGEST), eq(BINDING), anyString()))
        .thenReturn(true);

    Throwable thrown = catchThrowable(
        () -> service.reset(new ResetPasswordRequest(RAW_TOKEN, NEW_PASSWORD)));

    assertThat(thrown).isSameAs(policyError);
    verify(store).recoverClaim(eq(TOKEN_DIGEST), eq(BINDING), anyString());
    verifyNoInteractions(passwordEncoder, transactions);
  }

  @Test
  void databaseFailureRecoversClaimForSafeRetryAndReturnsUnavailable() {
    stubClaimedReset();
    when(passwordEncoder.encode(NEW_PASSWORD))
        .thenReturn(PasswordResetTestFixtures.NEXT_HASH);
    when(transactions.reset(any(), eq(BINDING.userVersion()), anyString(), any()))
        .thenThrow(new DataAccessResourceFailureException("database offline"));
    when(store.recoverClaim(eq(TOKEN_DIGEST), eq(BINDING), anyString()))
        .thenReturn(true);

    assertUnavailable(
        () -> service.reset(new ResetPasswordRequest(RAW_TOKEN, NEW_PASSWORD)));

    verify(store).recoverClaim(eq(TOKEN_DIGEST), eq(BINDING), anyString());
    verify(store, never()).finalizeClaim(anyString(), anyString(), any(), anyString());
  }

  @Test
  void staleAccountBindingBurnsClaimAndReturnsGenericInvalidToken() {
    stubClaimedReset();
    when(passwordEncoder.encode(NEW_PASSWORD))
        .thenReturn(PasswordResetTestFixtures.NEXT_HASH);
    when(transactions.reset(any(), eq(BINDING.userVersion()), anyString(), any()))
        .thenThrow(new PasswordResetRejectedException());
    when(store.finalizeClaim(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(BINDING), anyString()))
        .thenReturn(true);

    AuthBusinessException error = captureBusiness(
        () -> service.reset(new ResetPasswordRequest(RAW_TOKEN, NEW_PASSWORD)));

    assertInvalidReset(error);
    verify(store).finalizeClaim(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(BINDING), anyString());
    verify(store, never()).recoverClaim(anyString(), any(), anyString());
  }

  @Test
  void postCommitRedisCleanupFailuresNeverTurnSuccessfulResetIntoRetry() {
    stubClaimedReset();
    when(passwordEncoder.encode(NEW_PASSWORD))
        .thenReturn(PasswordResetTestFixtures.NEXT_HASH);
    when(transactions.reset(any(), eq(BINDING.userVersion()), anyString(), any()))
        .thenReturn(new ResetAccount(PasswordResetTestFixtures.EMAIL));
    when(store.finalizeClaim(
        eq(TOKEN_DIGEST), eq(USER_KEY), eq(BINDING), anyString()))
        .thenThrow(new DataAccessResourceFailureException("redis offline"));
    doThrow(new LoginAttemptStoreUnavailableException("redis offline"))
        .when(loginAttempts)
        .clearAfterPasswordReset(PasswordResetTestFixtures.EMAIL);

    service.reset(new ResetPasswordRequest(RAW_TOKEN, NEW_PASSWORD));

    verify(loginAttempts).clearAfterPasswordReset(PasswordResetTestFixtures.EMAIL);
    verify(store, never()).recoverClaim(anyString(), any(), anyString());
  }

  private void stubForgotQuota() {
    when(tokens.emailKey(PasswordResetTestFixtures.EMAIL)).thenReturn(EMAIL_KEY);
    when(store.reserveRequest(eq(EMAIL_KEY), anyString())).thenReturn(true);
  }

  private Binding stubEligibleForgot(AuthUser user) {
    stubForgotQuota();
    when(users.findByNormalizedEmail(PasswordResetTestFixtures.EMAIL))
        .thenReturn(Optional.of(user));
    when(tokens.issue()).thenReturn(MATERIAL);
    when(tokens.userKey(user.getId())).thenReturn(USER_KEY);
    Binding binding = new Binding(user.getId(), user.getVersion());
    when(store.install(TOKEN_DIGEST, USER_KEY, binding))
        .thenReturn(InstallStatus.INSTALLED);
    return binding;
  }

  private void stubClaimedReset() {
    when(tokens.digestPresented(RAW_TOKEN)).thenReturn(Optional.of(TOKEN_DIGEST));
    when(store.claim(eq(TOKEN_DIGEST), anyString())).thenReturn(
        new ClaimResult(ClaimStatus.CLAIMED, BINDING, Duration.ofSeconds(30)));
    when(tokens.userKey(USER_ID)).thenReturn(USER_KEY);
  }

  private void assertGenericForgot(ForgotPasswordResponse response) {
    assertThat(response.status()).isEqualTo("RESET_EMAIL_SENT_IF_ELIGIBLE");
    assertThat(response.expiresInSeconds()).isEqualTo(900);
    assertThat(response.toString())
        .doesNotContain(PasswordResetTestFixtures.EMAIL)
        .doesNotContain(RAW_TOKEN);
  }

  private void assertUnavailable(Runnable invocation) {
    AuthBusinessException error = captureBusiness(invocation);
    assertThat(error.code()).isEqualTo("PASSWORD_RESET_UNAVAILABLE");
    assertThat(error.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(error.details()).isEmpty();
  }

  private AuthBusinessException captureBusiness(Runnable invocation) {
    Throwable thrown = catchThrowable(invocation::run);
    assertThat(thrown).isInstanceOf(AuthBusinessException.class);
    return (AuthBusinessException) thrown;
  }

  private void assertInvalidReset(AuthBusinessException error) {
    assertThat(error.code()).isEqualTo("RESET_TOKEN_INVALID_OR_EXPIRED");
    assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(error.details()).isEmpty();
    assertThat(error.getMessage())
        .doesNotContain(RAW_TOKEN)
        .doesNotContain(USER_ID.toString());
  }
}
