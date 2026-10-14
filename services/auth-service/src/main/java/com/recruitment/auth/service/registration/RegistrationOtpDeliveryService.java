package com.recruitment.auth.service.registration;

import com.recruitment.auth.config.properties.OtpProperties;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.infrastructure.mail.OtpEmailSender;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.DispatchPreflightResult;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.InstallResult;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.KeyTtl;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore.ResendReservationResult;
import com.recruitment.auth.repository.redis.otp.RedisOtpChallengeStore;
import com.recruitment.auth.security.otp.OtpChallengeCodec;
import com.recruitment.auth.security.otp.OtpCodeGenerator;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class RegistrationOtpDeliveryService {
  private static final Logger log = LoggerFactory.getLogger(RegistrationOtpDeliveryService.class);

  private final OtpCodeGenerator codes;
  private final OtpChallengeCodec codec;
  private final RedisOtpChallengeStore store;
  private final OtpEmailSender emailSender;
  private final OtpProperties properties;

  public RegistrationOtpDeliveryService(
      OtpCodeGenerator codes,
      OtpChallengeCodec codec,
      RedisOtpChallengeStore store,
      OtpEmailSender emailSender,
      OtpProperties properties) {
    this.codes = codes;
    this.codec = codec;
    this.store = store;
    this.emailSender = emailSender;
    this.properties = properties;
  }

  /**
   * Serializes registration work for one email. A monotonic database fence protects against a
   * stale writer if the Redis lease expires while persistence is in flight. Redis preflight and
   * resend reservation happen before the database mutation, while the challenge is encoded only
   * after persistence returns the stable user ID retained by PostgreSQL.
   */
  public Optional<DispatchResult> dispatch(
      String normalizedEmail,
      DispatchPlanSupplier plans) {
    Objects.requireNonNull(plans, "plans are required");
    String emailKey = codec.emailKey(normalizedEmail);
    String dispatchToken = token();
    if (!redis(() -> store.acquireDispatchLock(emailKey, dispatchToken))) {
      throw throttled(
          "OTP_DISPATCH_IN_PROGRESS",
          "A verification email is already being prepared",
          1);
    }

    String reservationToken = null;
    String storedChallenge = null;
    boolean delivered = false;
    try {
      Optional<DispatchPlan> optionalPlan = Objects.requireNonNull(
          plans.prepare(), "dispatch plan result is required");
      if (optionalPlan.isEmpty()) {
        return Optional.empty();
      }
      DispatchPlan plan = optionalPlan.orElseThrow();

      if (plan.resend()) {
        String newReservationToken = token();
        reservationToken = newReservationToken;
        ResendReservationResult reservation =
            redis(() -> store.reserveResend(emailKey, newReservationToken));
        if (!reservation.reserved()) {
          throw throttled(
              "OTP_RESEND_LIMITED",
              "Too many verification-code resend requests",
              retrySeconds(reservation.retryAfter()));
        }
      }

      requirePreflight(
          redis(() -> store.preflightDispatch(emailKey, dispatchToken)),
          emailKey);
      requireLeaseRenewed(emailKey, dispatchToken);

      AuthUser persisted = Objects.requireNonNull(
          plan.persist().get(), "persisted registration is required");
      validateCurrentFlow(normalizedEmail, plan, persisted, null);
      requireLeaseRenewed(emailKey, dispatchToken);

      String code = codes.generate();
      storedChallenge = codec.encodeRegistration(
          persisted.getId(),
          plan.registrationId(),
          normalizedEmail,
          code);
      String challengeSnapshot = storedChallenge;
      InstallResult install = redis(() -> store.installChallenge(
          emailKey, challengeSnapshot, dispatchToken));
      requireInstalled(install, emailKey);

      AuthUser beforeEmail = Objects.requireNonNull(
          plan.current().get(), "current registration is required");
      validateCurrentFlow(normalizedEmail, plan, beforeEmail, persisted.getId());
      requireLeaseRenewed(emailKey, dispatchToken);

      try {
        emailSender.sendRegistrationOtp(beforeEmail.getEmail(), code);
      } catch (RuntimeException deliveryFailure) {
        throw new AuthBusinessException(
            "OTP_EMAIL_UNAVAILABLE",
            "Verification email could not be delivered; try again later",
            HttpStatus.SERVICE_UNAVAILABLE);
      }
      requireLeaseRenewed(emailKey, dispatchToken);

      AuthUser afterEmail = Objects.requireNonNull(
          plan.current().get(), "current registration is required");
      validateCurrentFlow(normalizedEmail, plan, afterEmail, persisted.getId());
      delivered = true;
      return Optional.of(new DispatchResult(
          properties.ttl().toSeconds(), plan.resend(), afterEmail));
    } catch (RuntimeException failure) {
      if (!delivered) {
        cleanupFailedDispatch(emailKey, storedChallenge, reservationToken);
      }
      throw failure;
    } finally {
      try {
        store.releaseDispatchLock(emailKey, dispatchToken);
      } catch (RuntimeException releaseFailure) {
        log.warn("OTP dispatch lock release failed; the lease will expire automatically");
      }
    }
  }

  private void requirePreflight(DispatchPreflightResult preflight, String emailKey) {
    if (preflight == DispatchPreflightResult.READY) {
      return;
    }
    if (preflight == DispatchPreflightResult.FAILURE_BLOCKED) {
      throw throttled(
          "OTP_VERIFICATION_BLOCKED",
          "OTP verification is temporarily blocked",
          retrySeconds(ttlOrDefault(
              redis(() -> store.failureTtl(emailKey)),
              properties.failureBlockDuration())));
    }
    if (preflight == DispatchPreflightResult.DISPATCH_LOCK_NOT_OWNED) {
      throw dispatchLeaseLost();
    }
    throw throttled(
        "OTP_VERIFICATION_IN_PROGRESS",
        "OTP verification is already in progress",
        retrySeconds(ttlOrDefault(
            redis(() -> store.claimTtl(emailKey)),
            properties.claimTtl())));
  }

  private void requireInstalled(InstallResult install, String emailKey) {
    if (install == InstallResult.INSTALLED) {
      return;
    }
    if (install == InstallResult.FAILURE_BLOCKED) {
      throw throttled(
          "OTP_VERIFICATION_BLOCKED",
          "OTP verification is temporarily blocked",
          retrySeconds(ttlOrDefault(
              redis(() -> store.failureTtl(emailKey)),
              properties.failureBlockDuration())));
    }
    if (install == InstallResult.DISPATCH_LOCK_NOT_OWNED) {
      throw dispatchLeaseLost();
    }
    throw throttled(
        "OTP_VERIFICATION_IN_PROGRESS",
        "OTP verification is already in progress",
        retrySeconds(ttlOrDefault(
            redis(() -> store.claimTtl(emailKey)),
            properties.claimTtl())));
  }

  private void requireLeaseRenewed(String emailKey, String dispatchToken) {
    if (!redis(() -> store.renewDispatchLock(emailKey, dispatchToken))) {
      throw dispatchLeaseLost();
    }
  }

  private AuthBusinessException dispatchLeaseLost() {
    return throttled(
        "OTP_DISPATCH_IN_PROGRESS",
        "A newer verification email request is already in progress",
        1);
  }

  private static void validateCurrentFlow(
      String normalizedEmail,
      DispatchPlan plan,
      AuthUser current,
      UUID expectedUserId) {
    if (current.isVerified()
        || !normalizedEmail.equals(current.getNormalizedEmail())
        || (expectedUserId != null && !expectedUserId.equals(current.getId()))
        || !plan.registrationId().equals(current.getRegistrationId())
        || plan.registrationFence() != current.getRegistrationFence()) {
      throw new AuthBusinessException(
          "ACCOUNT_STORE_UNAVAILABLE",
          "Account service is temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private void cleanupFailedDispatch(
      String emailKey,
      String storedChallenge,
      String reservationToken) {
    if (storedChallenge != null) {
      try {
        store.compareAndDeleteChallenge(emailKey, storedChallenge);
      } catch (RuntimeException cleanupFailure) {
        log.warn("OTP challenge cleanup failed after dispatch failure");
      }
    }
    if (reservationToken != null) {
      try {
        store.rollbackResendReservation(emailKey, reservationToken);
      } catch (RuntimeException rollbackFailure) {
        log.warn("OTP resend reservation rollback failed");
      }
    }
  }

  private <T> T redis(RedisOperation<T> operation) {
    try {
      return operation.run();
    } catch (AuthBusinessException exception) {
      throw exception;
    } catch (RuntimeException infrastructureFailure) {
      throw new AuthBusinessException(
          "OTP_STORE_UNAVAILABLE",
          "Verification service is temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private AuthBusinessException throttled(String code, String message, long retryAfterSeconds) {
    long safeRetry = Math.max(1, retryAfterSeconds);
    return new AuthBusinessException(
        code,
        message,
        HttpStatus.TOO_MANY_REQUESTS,
        Map.of("retryAfterSeconds", safeRetry),
        safeRetry);
  }

  private static Duration ttlOrDefault(KeyTtl ttl, Duration fallback) {
    return ttl.state() == RedisOtpChallengeStore.TtlState.EXPIRING
        ? ttl.remaining()
        : fallback;
  }

  private static long retrySeconds(Duration duration) {
    long milliseconds = Math.max(1, duration.toMillis());
    return Math.max(1, (milliseconds + 999) / 1000);
  }

  private static String token() {
    return UUID.randomUUID().toString();
  }

  public record DispatchPlan(
      UUID registrationId,
      long registrationFence,
      boolean resend,
      Supplier<AuthUser> persist,
      Supplier<AuthUser> current) {
    public DispatchPlan {
      Objects.requireNonNull(registrationId, "registrationId is required");
      if (registrationFence < 0) {
        throw new IllegalArgumentException("registrationFence cannot be negative");
      }
      Objects.requireNonNull(persist, "persist is required");
      Objects.requireNonNull(current, "current is required");
    }
  }

  public record DispatchResult(long expiresInSeconds, boolean resend, AuthUser user) {
    public DispatchResult {
      Objects.requireNonNull(user, "user is required");
    }
  }

  @FunctionalInterface
  public interface DispatchPlanSupplier {
    Optional<DispatchPlan> prepare();
  }

  @FunctionalInterface
  private interface RedisOperation<T> {
    T run();
  }
}
