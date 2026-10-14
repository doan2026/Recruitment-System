package com.recruitment.auth.service.accountcontrol;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.recruitment.auth.dto.accountcontrol.AccountLockResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.service.accountcontrol.AdminAccountControlTransactions.AccountControlResult;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.TransactionSystemException;

class AdminAccountControlServiceTest {
  private static final UUID ACTOR_ID =
      UUID.fromString("11111111-2222-4333-8444-555555555555");
  private static final UUID TARGET_ID =
      UUID.fromString("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  private static final Instant NOW = Instant.parse("2026-08-27T08:15:30Z");

  private AdminAccountControlTransactions transactions;
  private AdminAccountControlService service;

  @BeforeEach
  void setUp() {
    transactions = org.mockito.Mockito.mock(AdminAccountControlTransactions.class);
    service = new AdminAccountControlService(transactions);
  }

  @Test
  void normalizesReasonDelegatesTrustedIdentifiersAndMapsMinimalResult() {
    String decomposedReason = "\u00a0 Ta\u0300i khoa\u0309n vi pha\u0323m \u202f";
    String normalizedReason = "Tài khoản vi phạm";
    AccountControlResult result =
        new AccountControlResult(TARGET_ID, true, NOW, 9, 3);
    when(transactions.update(
        ACTOR_ID, TARGET_ID, true, normalizedReason))
        .thenReturn(result);

    AccountLockResponse response = service.update(
        ACTOR_ID, TARGET_ID, true, decomposedReason);

    assertThat(response).isEqualTo(
        new AccountLockResponse(TARGET_ID, true, NOW, 9, 3));
    verify(transactions).update(
        ACTOR_ID, TARGET_ID, true, normalizedReason);
  }

  @Test
  void rejectsMissingBlankAndOversizedLockReasonsBeforeTheTransaction() {
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, true, null),
        "reason");
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, true, " \n\t "),
        "reason");
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, true, "\u00a0\u2007\u202f"),
        "reason");
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, true, "Policy\nviolation"),
        "reason");
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, true, "Policy\u202eviolation"),
        "reason");
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, true, "x".repeat(501)),
        "reason");

    verifyNoInteractions(transactions);
  }

  @Test
  void unlockRequiresReasonToBeOmittedButTreatsWhitespaceAsAbsent() {
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, false, "not needed"),
        "reason");
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, false, "\u200f"),
        "reason");

    AccountControlResult result =
        new AccountControlResult(TARGET_ID, false, null, 10, 0);
    when(transactions.update(ACTOR_ID, TARGET_ID, false, null))
        .thenReturn(result);

    assertThat(service.update(ACTOR_ID, TARGET_ID, false, " \u00a0\u202f "))
        .isEqualTo(new AccountLockResponse(TARGET_ID, false, null, 10, 0));
    verify(transactions).update(ACTOR_ID, TARGET_ID, false, null);
  }

  @Test
  void rejectsMissingDesiredStateBeforeTheTransaction() {
    assertValidation(
        () -> service.update(ACTOR_ID, TARGET_ID, null, "Policy violation"),
        "locked");

    verifyNoInteractions(transactions);
  }

  @Test
  void mapsOnlyPersistenceAndTransactionFailuresToGenericServiceUnavailable() {
    when(transactions.update(ACTOR_ID, TARGET_ID, true, "Policy violation"))
        .thenThrow(new DataAccessResourceFailureException("database offline"));

    assertUnavailable(() -> service.update(
        ACTOR_ID, TARGET_ID, true, "Policy violation"));

    org.mockito.Mockito.reset(transactions);
    when(transactions.update(ACTOR_ID, TARGET_ID, true, "Policy violation"))
        .thenThrow(new TransactionSystemException("commit failed"));

    assertUnavailable(() -> service.update(
        ACTOR_ID, TARGET_ID, true, "Policy violation"));
  }

  @Test
  void preservesDurableAuthorizationAndTargetErrorsFromTheTransaction() {
    AuthBusinessException denied = new AuthBusinessException(
        "ADMIN_ACCESS_DENIED",
        "Administrative access is denied",
        HttpStatus.FORBIDDEN,
        Map.of());
    when(transactions.update(ACTOR_ID, TARGET_ID, true, "Policy violation"))
        .thenThrow(denied);

    assertThatThrownBy(() -> service.update(
        ACTOR_ID, TARGET_ID, true, "Policy violation"))
        .isSameAs(denied);
  }

  private static void assertValidation(
      org.assertj.core.api.ThrowableAssert.ThrowingCallable invocation,
      String field) {
    assertThatThrownBy(invocation)
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("VALIDATION_ERROR");
          assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
          assertThat(exception.details()).containsKey(field);
        });
  }

  private static void assertUnavailable(
      org.assertj.core.api.ThrowableAssert.ThrowingCallable invocation) {
    assertThatThrownBy(invocation)
        .isInstanceOfSatisfying(AuthBusinessException.class, exception -> {
          assertThat(exception.code()).isEqualTo("ACCOUNT_CONTROL_UNAVAILABLE");
          assertThat(exception.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
          assertThat(exception.getMessage())
              .doesNotContain("database", "commit");
        });
  }
}
