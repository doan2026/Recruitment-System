package com.recruitment.auth.passwordreset;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.IdentityNormalizer;
import com.recruitment.auth.login.LoginAttemptLimiter;
import com.recruitment.auth.login.LoginAttemptStoreUnavailableException;
import com.recruitment.auth.passwordreset.PasswordResetTransactions.ResetAccount;
import com.recruitment.auth.passwordreset.RedisPasswordResetStore.Binding;
import com.recruitment.auth.passwordreset.RedisPasswordResetStore.ClaimResult;
import com.recruitment.auth.passwordreset.RedisPasswordResetStore.ClaimStatus;
import com.recruitment.auth.passwordreset.RedisPasswordResetStore.InstallStatus;
import com.recruitment.auth.passwordreset.api.ForgotPasswordRequest;
import com.recruitment.auth.passwordreset.api.ForgotPasswordResponse;
import com.recruitment.auth.passwordreset.api.ResetPasswordRequest;
import com.recruitment.auth.registration.RegistrationPasswordPolicy;
import java.time.Clock;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class PasswordResetService {
  private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);
  private static final String GENERIC_FORGOT_STATUS = "RESET_EMAIL_SENT_IF_ELIGIBLE";

  private final AuthUserRepository users;
  private final PasswordResetTokenCodec tokens;
  private final RedisPasswordResetStore store;
  private final PasswordResetEmailSender emailSender;
  private final PasswordResetProperties properties;
  private final RegistrationPasswordPolicy passwordPolicy;
  private final PasswordEncoder passwordEncoder;
  private final PasswordResetTransactions transactions;
  private final LoginAttemptLimiter loginAttempts;
  private final AsyncTaskExecutor mailExecutor;
  private final Clock clock;

  public PasswordResetService(
      AuthUserRepository users,
      PasswordResetTokenCodec tokens,
      RedisPasswordResetStore store,
      PasswordResetEmailSender emailSender,
      PasswordResetProperties properties,
      RegistrationPasswordPolicy passwordPolicy,
      PasswordEncoder passwordEncoder,
      PasswordResetTransactions transactions,
      LoginAttemptLimiter loginAttempts,
      @Qualifier("passwordResetMailExecutor") AsyncTaskExecutor mailExecutor,
      Clock clock) {
    this.users = users;
    this.tokens = tokens;
    this.store = store;
    this.emailSender = emailSender;
    this.properties = properties;
    this.passwordPolicy = passwordPolicy;
    this.passwordEncoder = passwordEncoder;
    this.transactions = transactions;
    this.loginAttempts = loginAttempts;
    this.mailExecutor = mailExecutor;
    this.clock = clock;
  }

  public ForgotPasswordResponse forgot(ForgotPasswordRequest request) {
    Objects.requireNonNull(request, "request is required");
    String normalizedEmail = normalizeEmail(request.email());
    ForgotPasswordResponse genericResponse = genericForgotResponse();
    String emailKey = tokens.emailKey(normalizedEmail);
    String requestToken = UUID.randomUUID().toString();

    try {
      if (!store.reserveRequest(emailKey, requestToken)) {
        return genericResponse;
      }
    } catch (DataAccessException | IllegalStateException storeFailure) {
      throw resetUnavailable();
    }

    Optional<AuthUser> candidate;
    try {
      candidate = users.findByNormalizedEmail(normalizedEmail);
    } catch (DataAccessException accountStoreFailure) {
      rollbackRequestQuietly(emailKey, requestToken);
      throw resetUnavailable();
    }
    if (candidate.isEmpty() || !eligible(candidate.orElseThrow())) {
      return genericResponse;
    }

    AuthUser user = candidate.orElseThrow();
    PasswordResetTokenCodec.Material material = tokens.issue();
    Binding binding = new Binding(user.getId(), user.getVersion());
    String userKey = tokens.userKey(user.getId());
    try {
      if (store.install(material.tokenDigest(), userKey, binding)
          != InstallStatus.INSTALLED) {
        return genericResponse;
      }
    } catch (DataAccessException | IllegalStateException storeFailure) {
      rollbackRequestQuietly(emailKey, requestToken);
      log.warn("Password-reset challenge installation failed; request kept generic");
      return genericResponse;
    }

    String deliveryToken = UUID.randomUUID().toString();
    try {
      mailExecutor.execute(
          () -> deliverOrDiscard(
              user.getEmail(), material, userKey, binding, deliveryToken));
    } catch (TaskRejectedException schedulingFailure) {
      discardQuietly(material.tokenDigest(), userKey, binding);
      rollbackRequestQuietly(emailKey, requestToken);
      log.warn("Password-reset email queue rejected a task; challenge was discarded");
    }
    return genericResponse;
  }

  public void reset(ResetPasswordRequest request) {
    Objects.requireNonNull(request, "request is required");
    String tokenDigest = tokens.digestPresented(request.token())
        .orElseThrow(this::invalidResetToken);
    String claimToken = UUID.randomUUID().toString();
    ClaimResult claim;
    try {
      claim = store.claim(tokenDigest, claimToken);
    } catch (DataAccessException | IllegalStateException storeFailure) {
      throw resetUnavailable();
    }
    if (claim.status() != ClaimStatus.CLAIMED) {
      throw invalidResetToken();
    }
    Binding binding = claim.binding();
    String userKey = tokens.userKey(binding.userId());

    try {
      passwordPolicy.validate(request.newPassword());
    } catch (RuntimeException policyFailure) {
      recoverQuietly(tokenDigest, binding, claimToken);
      throw policyFailure;
    }

    String passwordHash;
    try {
      passwordHash = passwordEncoder.encode(request.newPassword());
    } catch (RuntimeException encodingFailure) {
      recoverQuietly(tokenDigest, binding, claimToken);
      throw resetUnavailable();
    }

    ResetAccount account;
    try {
      account = transactions.reset(
          binding.userId(),
          binding.userVersion(),
          passwordHash,
          clock.instant());
    } catch (PasswordResetRejectedException rejected) {
      finalizeQuietly(tokenDigest, userKey, binding, claimToken);
      throw invalidResetToken();
    } catch (RuntimeException databaseFailure) {
      recoverQuietly(tokenDigest, binding, claimToken);
      throw resetUnavailable();
    }

    finalizeQuietly(tokenDigest, userKey, binding, claimToken);
    try {
      loginAttempts.clearAfterPasswordReset(account.normalizedEmail());
    } catch (LoginAttemptStoreUnavailableException cleanupFailure) {
      log.warn("Login-attempt cleanup failed after password reset commit");
    }
  }

  private void deliverOrDiscard(
      String recipient,
      PasswordResetTokenCodec.Material material,
      String userKey,
      Binding binding,
      String deliveryToken) {
    try {
      if (!store.acquireDelivery(
          material.tokenDigest(), userKey, binding, deliveryToken)) {
        return;
      }
    } catch (DataAccessException | IllegalStateException preflightFailure) {
      log.warn("Password-reset delivery preflight failed; email was not sent");
      return;
    }

    boolean delivered = false;
    try {
      emailSender.sendPasswordReset(recipient, material.rawToken());
      delivered = true;
    } catch (RuntimeException deliveryFailure) {
      log.warn("Password-reset email delivery failed");
    } finally {
      releaseDeliveryQuietly(material.tokenDigest(), deliveryToken);
    }
    if (!delivered) {
      discardQuietly(material.tokenDigest(), userKey, binding);
    }
  }

  private void rollbackRequestQuietly(
      String emailKey,
      String requestToken) {
    try {
      if (!store.rollbackRequest(emailKey, requestToken)) {
        log.warn("Password-reset request quota rollback was not acknowledged");
      }
    } catch (DataAccessException | IllegalStateException rollbackFailure) {
      log.warn("Password-reset request quota rollback failed; it will expire automatically");
    }
  }

  private void discardQuietly(
      String tokenDigest,
      String userKey,
      Binding binding) {
    try {
      if (!store.discardUnclaimed(tokenDigest, userKey, binding)) {
        log.warn("Password-reset challenge discard was not acknowledged");
      }
    } catch (DataAccessException | IllegalStateException cleanupFailure) {
      log.warn("Password-reset challenge cleanup failed; it will expire automatically");
    }
  }

  private void releaseDeliveryQuietly(
      String tokenDigest,
      String deliveryToken) {
    try {
      if (!store.releaseDelivery(tokenDigest, deliveryToken)) {
        log.warn("Password-reset delivery lease release was not acknowledged");
      }
    } catch (DataAccessException | IllegalStateException releaseFailure) {
      log.warn("Password-reset delivery lease release failed; it will expire automatically");
    }
  }

  private void recoverQuietly(
      String tokenDigest,
      Binding binding,
      String claimToken) {
    try {
      if (!store.recoverClaim(tokenDigest, binding, claimToken)) {
        log.warn("Password-reset claim recovery was not acknowledged");
      }
    } catch (DataAccessException | IllegalStateException recoveryFailure) {
      log.warn("Password-reset claim recovery failed; its lease will expire automatically");
    }
  }

  private void finalizeQuietly(
      String tokenDigest,
      String userKey,
      Binding binding,
      String claimToken) {
    try {
      if (!store.finalizeClaim(tokenDigest, userKey, binding, claimToken)) {
        log.warn("Password-reset claim finalization was not acknowledged");
      }
    } catch (DataAccessException | IllegalStateException finalizeFailure) {
      log.warn("Password-reset claim finalization failed after account decision");
    }
  }

  private ForgotPasswordResponse genericForgotResponse() {
    return new ForgotPasswordResponse(
        GENERIC_FORGOT_STATUS,
        properties.ttl().toSeconds());
  }

  private static boolean eligible(AuthUser user) {
    return user.isVerified() && user.getPasswordHash() != null;
  }

  private String normalizeEmail(String email) {
    try {
      return IdentityNormalizer.normalizeEmail(email);
    } catch (IllegalArgumentException exception) {
      throw new AuthBusinessException(
          "INVALID_EMAIL",
          "Email address is invalid",
          HttpStatus.BAD_REQUEST);
    }
  }

  private AuthBusinessException invalidResetToken() {
    return new AuthBusinessException(
        "RESET_TOKEN_INVALID_OR_EXPIRED",
        "Password reset token is invalid or expired",
        HttpStatus.BAD_REQUEST);
  }

  private AuthBusinessException resetUnavailable() {
    return new AuthBusinessException(
        "PASSWORD_RESET_UNAVAILABLE",
        "Password reset is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE);
  }
}
