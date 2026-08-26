package com.recruitment.auth.login;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.UserRole;
import com.recruitment.auth.login.LoginAttemptLimiter.AttemptDecision;
import com.recruitment.auth.login.api.LoginRequest;
import com.recruitment.auth.token.TokenSessionService;
import com.recruitment.auth.token.api.AuthTokenResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

class LoginServiceTest {
  private static final String EMAIL = "candidate@example.com";
  private static final String PASSWORD = "candidate1";
  private static final String HASH = "$2a$10$" + "a".repeat(53);
  private static final Instant VERIFIED_AT = Instant.parse("2026-08-26T10:00:00Z");

  private AuthUserRepository users;
  private PasswordEncoder passwordEncoder;
  private LoginAttemptLimiter attempts;
  private TokenSessionService tokenSessions;
  private LoginService service;

  @BeforeEach
  void setUp() {
    users = org.mockito.Mockito.mock(AuthUserRepository.class);
    passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    attempts = org.mockito.Mockito.mock(LoginAttemptLimiter.class);
    tokenSessions = org.mockito.Mockito.mock(TokenSessionService.class);
    service = new LoginService(users, passwordEncoder, attempts, tokenSessions);
    when(attempts.preflight(EMAIL)).thenReturn(AttemptDecision.allowed(0));
  }

  @Test
  void issuesTokensForCanonicalVerifiedPasswordLogin() {
    AuthUser user = verifiedUser();
    AuthTokenResponse response = org.mockito.Mockito.mock(AuthTokenResponse.class);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(user));
    when(passwordEncoder.matches(PASSWORD, HASH)).thenReturn(true);
    when(attempts.completeSuccessfulCredential(EMAIL))
        .thenReturn(AttemptDecision.allowed(2));
    when(tokenSessions.issueForPasswordLogin(user.getId(), HASH)).thenReturn(response);

    assertThat(service.login(new LoginRequest(
        " Candidate@Example.COM ", PASSWORD))).isSameAs(response);

    verify(attempts).preflight(EMAIL);
    verify(attempts).completeSuccessfulCredential(EMAIL);
    verify(tokenSessions).issueForPasswordLogin(user.getId(), HASH);
    verify(attempts, never()).recordFailure(anyString());
  }

  @Test
  void missingAccountUsesCostTenDummyBcryptAndGenericError() {
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.empty());
    when(attempts.recordFailure(EMAIL)).thenReturn(AttemptDecision.failed(1));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertGenericCredentials(error);
    ArgumentCaptor<String> hash = ArgumentCaptor.forClass(String.class);
    verify(passwordEncoder).matches(org.mockito.ArgumentMatchers.eq(PASSWORD), hash.capture());
    assertThat(hash.getValue()).matches("^[$]2[aby][$]10[$][./A-Za-z0-9]{53}$");
    verify(attempts).recordFailure(EMAIL);
    verify(tokenSessions, never()).issueForPasswordLogin(
        org.mockito.ArgumentMatchers.any(), anyString());
  }

  @Test
  void oauthOnlyAccountUsesSameDummyBcryptAndGenericError() {
    AuthUser oauthUser = AuthUser.registerOAuth(EMAIL, VERIFIED_AT);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(oauthUser));
    when(attempts.recordFailure(EMAIL)).thenReturn(AttemptDecision.failed(2));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertGenericCredentials(error);
    ArgumentCaptor<String> hash = ArgumentCaptor.forClass(String.class);
    verify(passwordEncoder).matches(org.mockito.ArgumentMatchers.eq(PASSWORD), hash.capture());
    assertThat(hash.getValue()).matches("^[$]2[aby][$]10[$][./A-Za-z0-9]{53}$");
  }

  @Test
  void wrongPasswordReturnsTheSameGenericErrorAndRecordsFailure() {
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(verifiedUser()));
    when(passwordEncoder.matches(PASSWORD, HASH)).thenReturn(false);
    when(attempts.recordFailure(EMAIL)).thenReturn(AttemptDecision.failed(4));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertGenericCredentials(error);
    verify(attempts).recordFailure(EMAIL);
  }

  @Test
  void fifthFailureReturnsRateLimitWithRetryAfter() {
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.empty());
    when(attempts.recordFailure(EMAIL)).thenReturn(
        AttemptDecision.blocked(5, Duration.ofMillis(899_001)));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertThat(error.code()).isEqualTo("LOGIN_TEMPORARILY_BLOCKED");
    assertThat(error.status()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    assertThat(error.retryAfterSeconds()).isEqualTo(900);
    assertThat(error.details()).containsEntry("retryAfterSeconds", 900L);
  }

  @Test
  void activeBlockStopsBeforeDatabaseAndBcrypt() {
    when(attempts.preflight(EMAIL)).thenReturn(
        AttemptDecision.blocked(5, Duration.ofSeconds(42)));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertThat(error.code()).isEqualTo("LOGIN_TEMPORARILY_BLOCKED");
    assertThat(error.retryAfterSeconds()).isEqualTo(42);
    verify(users, never()).findByNormalizedEmail(anyString());
    verify(passwordEncoder, never()).matches(anyString(), anyString());
  }

  @Test
  void newlyEstablishedConcurrentBlockWinsAfterCorrectBcrypt() {
    AuthUser user = verifiedUser();
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(user));
    when(passwordEncoder.matches(PASSWORD, HASH)).thenReturn(true);
    when(attempts.completeSuccessfulCredential(EMAIL)).thenReturn(
        AttemptDecision.blocked(5, Duration.ofSeconds(600)));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertThat(error.code()).isEqualTo("LOGIN_TEMPORARILY_BLOCKED");
    verify(tokenSessions, never()).issueForPasswordLogin(user.getId(), HASH);
  }

  @Test
  void correctPendingAccountClearsFailuresAndReturnsOnlyRegistrationIdentity() {
    AuthUser pending = AuthUser.registerLocal(EMAIL, HASH, UserRole.CANDIDATE);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(pending));
    when(passwordEncoder.matches(PASSWORD, HASH)).thenReturn(true);
    when(attempts.completeSuccessfulCredential(EMAIL))
        .thenReturn(AttemptDecision.allowed(3));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertThat(error.code()).isEqualTo("EMAIL_NOT_VERIFIED");
    assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(error.details()).containsOnlyKeys("registrationId");
    assertThat(error.details().get("registrationId")).isEqualTo(pending.getRegistrationId());
    verify(attempts).completeSuccessfulCredential(EMAIL);
    verify(tokenSessions, never()).issueForPasswordLogin(pending.getId(), HASH);
  }

  @Test
  void correctAdminLockedAccountDoesNotExposeStoredReason() {
    AuthUser locked = verifiedUser();
    locked.lock("Sensitive moderation evidence", VERIFIED_AT.plusSeconds(10));
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(locked));
    when(passwordEncoder.matches(PASSWORD, HASH)).thenReturn(true);
    when(attempts.completeSuccessfulCredential(EMAIL))
        .thenReturn(AttemptDecision.allowed(0));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertThat(error.code()).isEqualTo("ACCOUNT_LOCKED");
    assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(error.details()).isEmpty();
    assertThat(error.getMessage()).doesNotContain("moderation");
    verify(tokenSessions, never()).issueForPasswordLogin(locked.getId(), HASH);
  }

  @Test
  void oversizedUtf8PasswordStillRunsSafeBcryptButCanNeverAuthenticate() {
    String oversized = "é".repeat(37);
    when(users.findByNormalizedEmail(EMAIL)).thenReturn(Optional.of(verifiedUser()));
    when(passwordEncoder.matches(anyString(), org.mockito.ArgumentMatchers.eq(HASH)))
        .thenReturn(true);
    when(attempts.recordFailure(EMAIL)).thenReturn(AttemptDecision.failed(1));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, oversized)));

    assertGenericCredentials(error);
    ArgumentCaptor<String> checkedPassword = ArgumentCaptor.forClass(String.class);
    verify(passwordEncoder).matches(checkedPassword.capture(),
        org.mockito.ArgumentMatchers.eq(HASH));
    assertThat(checkedPassword.getValue()).isNotEqualTo(oversized);
    verify(attempts).recordFailure(EMAIL);
  }

  @Test
  void redisFailureFailsClosedBeforeLookingUpAccount() {
    when(attempts.preflight(EMAIL)).thenThrow(
        new LoginAttemptStoreUnavailableException(new IllegalStateException("offline")));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertThat(error.code()).isEqualTo("LOGIN_RATE_LIMIT_UNAVAILABLE");
    assertThat(error.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    verify(users, never()).findByNormalizedEmail(anyString());
  }

  @Test
  void databaseFailureReturnsServiceUnavailableWithoutRecordingCredentialFailure() {
    when(users.findByNormalizedEmail(EMAIL)).thenThrow(
        new DataAccessResourceFailureException("database offline"));

    AuthBusinessException error = captureBusinessException(
        () -> service.login(new LoginRequest(EMAIL, PASSWORD)));

    assertThat(error.code()).isEqualTo("ACCOUNT_STORE_UNAVAILABLE");
    assertThat(error.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    verify(attempts, never()).recordFailure(anyString());
  }

  private AuthUser verifiedUser() {
    AuthUser user = AuthUser.registerLocal(EMAIL, HASH, UserRole.CANDIDATE);
    user.verify(VERIFIED_AT);
    return user;
  }

  private AuthBusinessException captureBusinessException(Runnable invocation) {
    Throwable thrown = catchThrowable(invocation::run);
    assertThat(thrown).isInstanceOf(AuthBusinessException.class);
    return (AuthBusinessException) thrown;
  }

  private void assertGenericCredentials(AuthBusinessException error) {
    assertThat(error.code()).isEqualTo("INVALID_CREDENTIALS");
    assertThat(error.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(error.getMessage()).isEqualTo("Email or password is incorrect");
    assertThat(error.details()).isEmpty();
  }
}
