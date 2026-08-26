package com.recruitment.auth.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.UserRole;
import com.recruitment.auth.registration.RegistrationAccountStore.RegistrationAccount;
import com.recruitment.auth.registration.RegistrationOtpDeliveryService.DispatchPlan;
import com.recruitment.auth.registration.RegistrationOtpDeliveryService.DispatchPlanSupplier;
import com.recruitment.auth.registration.RegistrationOtpDeliveryService.DispatchResult;
import com.recruitment.auth.registration.api.RegisterRequest;
import com.recruitment.auth.registration.api.RegistrationRole;
import com.recruitment.auth.registration.api.ResendOtpRequest;
import com.recruitment.auth.registration.api.VerifyOtpRequest;
import com.recruitment.auth.registration.otp.OtpProperties;
import com.recruitment.auth.token.TokenSessionService;
import com.recruitment.auth.token.api.AuthTokenResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

class RegistrationServiceTest {
  private static final String EMAIL = "candidate@example.com";
  private static final String ATTACKER_HASH = "$2a$10$" + "a".repeat(53);
  private static final String VICTIM_HASH = "$2a$10$" + "b".repeat(53);
  private static final Instant VERIFIED_AT = Instant.parse("2026-08-26T10:00:00Z");

  private RegistrationAccountStore accounts;
  private RegistrationPasswordPolicy passwordPolicy;
  private PasswordEncoder passwordEncoder;
  private RegistrationOtpDeliveryService delivery;
  private RegistrationOtpVerificationService verification;
  private TokenSessionService tokenSessions;
  private RegistrationService service;

  @BeforeEach
  void setUp() {
    accounts = org.mockito.Mockito.mock(RegistrationAccountStore.class);
    passwordPolicy = org.mockito.Mockito.mock(RegistrationPasswordPolicy.class);
    passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    delivery = org.mockito.Mockito.mock(RegistrationOtpDeliveryService.class);
    verification = org.mockito.Mockito.mock(RegistrationOtpVerificationService.class);
    tokenSessions = org.mockito.Mockito.mock(TokenSessionService.class);
    service = new RegistrationService(
        accounts,
        passwordPolicy,
        passwordEncoder,
        delivery,
        verification,
        properties(),
        tokenSessions);
    when(tokenSessions.issueForVerifiedUser(any())).thenAnswer(invocation ->
        new AuthTokenResponse(
            "access-token", "Bearer", 900, "refresh-token", 604800,
            new AuthTokenResponse.UserInfo(
                invocation.getArgument(0), EMAIL, UserRole.CANDIDATE)));
    AtomicLong fences = new AtomicLong();
    when(accounts.nextRegistrationFence())
        .thenAnswer(invocation -> fences.incrementAndGet());
    emulateSuccessfulDelivery();
  }

  @Test
  void createsCanonicalPendingAccountAndReturnsRegistrationId() {
    when(accounts.find(EMAIL)).thenReturn(Optional.empty());
    when(passwordEncoder.encode("candidate1")).thenReturn(ATTACKER_HASH);
    when(accounts.upsertPending(any(AuthUser.class))).thenAnswer(invocation -> {
      AuthUser draft = invocation.getArgument(0);
      return new RegistrationAccount(draft, true, true);
    });

    var response = service.register(new RegisterRequest(
        " Candidate@Example.COM ", "candidate1", RegistrationRole.CANDIDATE));

    ArgumentCaptor<AuthUser> draft = ArgumentCaptor.forClass(AuthUser.class);
    verify(accounts).upsertPending(draft.capture());
    assertThat(response.status()).isEqualTo("OTP_REQUIRED");
    assertThat(response.expiresInSeconds()).isEqualTo(300);
    assertThat(response.registrationId()).isEqualTo(draft.getValue().getRegistrationId());
    assertThat(draft.getValue().getNormalizedEmail()).isEqualTo(EMAIL);
    assertThat(draft.getValue().getPasswordHash()).isEqualTo(ATTACKER_HASH);
    verify(passwordPolicy).validate("candidate1");
  }

  @Test
  void ownerRegistrationSupersedesAttackersCredentialsAndFlow() {
    AtomicReference<AuthUser> stored = new AtomicReference<>();
    when(accounts.find(EMAIL)).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
    when(passwordEncoder.encode("attacker1")).thenReturn(ATTACKER_HASH);
    when(passwordEncoder.encode("victim-pass1")).thenReturn(VICTIM_HASH);
    when(accounts.upsertPending(any(AuthUser.class))).thenAnswer(invocation -> {
      AuthUser draft = invocation.getArgument(0);
      AuthUser previous = stored.get();
      if (previous != null) {
        ReflectionTestUtils.setField(draft, "id", previous.getId());
      }
      stored.set(draft);
      return new RegistrationAccount(draft, true, previous == null);
    });

    var attacker = service.register(new RegisterRequest(
        EMAIL, "attacker1", RegistrationRole.RECRUITER));
    UUID userId = stored.get().getId();
    long attackerFence = stored.get().getRegistrationFence();
    var victim = service.register(new RegisterRequest(
        EMAIL, "victim-pass1", RegistrationRole.CANDIDATE));

    AuthUser victimPending = stored.get();
    assertThat(victim.status()).isEqualTo("OTP_RESENT");
    assertThat(victim.registrationId()).isNotEqualTo(attacker.registrationId());
    assertThat(victimPending.getId()).isEqualTo(userId);
    assertThat(victimPending.getRegistrationId()).isEqualTo(victim.registrationId());
    assertThat(victimPending.getRegistrationFence()).isGreaterThan(attackerFence);
    assertThat(victimPending.getPasswordHash()).isEqualTo(VICTIM_HASH);
    assertThat(victimPending.getRole()).isEqualTo(UserRole.CANDIDATE);

    assertThatThrownBy(() -> service.verify(
        new VerifyOtpRequest(EMAIL, attacker.registrationId(), "001234")))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_INVALID_OR_EXPIRED");
    verify(verification, never()).verify(
        any(AuthUser.class), eq(attacker.registrationId()), anyString());

    when(verification.verify(victimPending, victim.registrationId(), "654321"))
        .thenAnswer(invocation -> {
          victimPending.verify(VERIFIED_AT);
          return victimPending;
        });
    var activated = service.verify(
        new VerifyOtpRequest(EMAIL, victim.registrationId(), "654321"));

    assertThat(activated.user().id()).isEqualTo(victimPending.getId());
    verify(tokenSessions).issueForVerifiedUser(victimPending.getId());
    assertThat(stored.get().getPasswordHash()).isEqualTo(VICTIM_HASH);
    assertThat(stored.get().getRole()).isEqualTo(UserRole.CANDIDATE);
    assertThat(stored.get().getRegistrationId()).isNull();
  }

  @Test
  void verifiedDuplicateReturnsConflictWithoutMutatingAccount() {
    AuthUser existing = AuthUser.registerLocal(
        EMAIL, ATTACKER_HASH, UserRole.CANDIDATE);
    existing.verify(VERIFIED_AT);
    when(accounts.find(EMAIL)).thenReturn(Optional.of(existing));
    when(passwordEncoder.encode("candidate1")).thenReturn(VICTIM_HASH);

    assertThatThrownBy(() -> service.register(new RegisterRequest(
        EMAIL, "candidate1", RegistrationRole.CANDIDATE)))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("EMAIL_ALREADY_REGISTERED");
    verify(accounts, never()).upsertPending(any(AuthUser.class));
  }

  @Test
  void resendUsesEnumerationSafeResponseForMissingAccount() {
    UUID registrationId = UUID.randomUUID();
    when(accounts.find("missing@example.com")).thenReturn(Optional.empty());

    var response = service.resend(new ResendOtpRequest(
        "missing@example.com", registrationId));

    assertThat(response.status()).isEqualTo("OTP_SENT_IF_ELIGIBLE");
    assertThat(response.expiresInSeconds()).isEqualTo(300);
  }

  @Test
  void resendUsesEnumerationSafeResponseForMismatchedFlow() {
    AuthUser pending = AuthUser.registerLocal(
        EMAIL, ATTACKER_HASH, UserRole.CANDIDATE);
    when(accounts.find(EMAIL)).thenReturn(Optional.of(pending));

    var response = service.resend(new ResendOtpRequest(EMAIL, UUID.randomUUID()));

    assertThat(response.status()).isEqualTo("OTP_SENT_IF_ELIGIBLE");
    assertThat(response.expiresInSeconds()).isEqualTo(300);
    verify(accounts, never()).upsertPending(any(AuthUser.class));
  }

  @Test
  void verifyUsesSamePublicErrorForMissingAccount() {
    when(accounts.find("missing@example.com")).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.verify(new VerifyOtpRequest(
        "missing@example.com", UUID.randomUUID(), "123456")))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("OTP_INVALID_OR_EXPIRED");
    verify(verification, never()).verify(any(), any(), anyString());
  }

  @Test
  void verifyReturnsTheAccountActivatedByClaimWorkflow() {
    AuthUser pending = AuthUser.registerLocal(
        EMAIL, ATTACKER_HASH, UserRole.CANDIDATE);
    UUID registrationId = pending.getRegistrationId();
    when(accounts.find(EMAIL)).thenReturn(Optional.of(pending));
    when(verification.verify(pending, registrationId, "001234"))
        .thenAnswer(invocation -> {
          pending.verify(VERIFIED_AT);
          return pending;
        });

    var response = service.verify(
        new VerifyOtpRequest(EMAIL, registrationId, "001234"));

    assertThat(response.user().email()).isEqualTo(EMAIL);
    assertThat(response.user().role()).isEqualTo(UserRole.CANDIDATE);
    verify(tokenSessions).issueForVerifiedUser(pending.getId());
  }

  @Test
  void accountReloadInvariantFailureMapsToServiceUnavailable() {
    when(accounts.find(EMAIL)).thenReturn(Optional.empty());
    when(passwordEncoder.encode("candidate1")).thenReturn(ATTACKER_HASH);
    when(accounts.upsertPending(any(AuthUser.class)))
        .thenThrow(new IllegalStateException("registered account could not be loaded"));

    assertThatThrownBy(() -> service.register(new RegisterRequest(
        EMAIL, "candidate1", RegistrationRole.CANDIDATE)))
        .isInstanceOf(AuthBusinessException.class)
        .extracting(exception -> ((AuthBusinessException) exception).code())
        .isEqualTo("ACCOUNT_STORE_UNAVAILABLE");
  }

  @SuppressWarnings("unchecked")
  private void emulateSuccessfulDelivery() {
    when(delivery.dispatch(anyString(), any(DispatchPlanSupplier.class)))
        .thenAnswer(invocation -> {
          DispatchPlanSupplier plans = invocation.getArgument(1);
          Optional<DispatchPlan> optionalPlan = plans.prepare();
          if (optionalPlan.isEmpty()) {
            return Optional.empty();
          }
          DispatchPlan plan = optionalPlan.orElseThrow();
          AuthUser persisted = plan.persist().get();
          return Optional.of(new DispatchResult(300, plan.resend(), persisted));
        });
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
