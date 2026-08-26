package com.recruitment.auth.registration;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.registration.otp.OtpChallengeCodec;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore.ChallengeInspection;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore.ClaimResult;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore.ClaimStatus;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class RegistrationOtpVerificationService {
  private static final Logger log =
      LoggerFactory.getLogger(RegistrationOtpVerificationService.class);

  private final RegistrationAccountStore accounts;
  private final OtpChallengeCodec codec;
  private final RedisOtpChallengeStore store;
  private final Clock clock;

  public RegistrationOtpVerificationService(
      RegistrationAccountStore accounts,
      OtpChallengeCodec codec,
      RedisOtpChallengeStore store,
      Clock clock) {
    this.accounts = accounts;
    this.codec = codec;
    this.store = store;
    this.clock = clock;
  }

  public AuthUser verify(
      AuthUser candidate,
      UUID expectedRegistrationId,
      String presentedCode) {
    String email = candidate.getNormalizedEmail();
    long expectedRegistrationFence = candidate.getRegistrationFence();
    if (!Objects.equals(candidate.getRegistrationId(), expectedRegistrationId)) {
      throw invalidOtp();
    }

    String emailKey = codec.emailKey(email);
    ChallengeInspection inspection = redis(() -> store.inspectChallenge(emailKey));
    String storedChallenge = switch (inspection.state()) {
      case READY -> inspection.storedChallenge();
      case BLOCKED -> throw throttled(
          "OTP_VERIFICATION_BLOCKED",
          "OTP verification is temporarily blocked",
          retrySeconds(inspection.retryAfter()));
      case CLAIM_IN_PROGRESS -> throw throttled(
          "OTP_VERIFICATION_IN_PROGRESS",
          "OTP verification is already in progress",
          retrySeconds(inspection.retryAfter()));
      case MISSING -> throw invalidOtp();
    };

    // A dispatch may have superseded the detached candidate after the controller lookup. Re-read
    // after inspecting Redis; the claim script's dispatch fence then closes the remaining race.
    AuthUser current = requireCurrentFlow(
        email,
        candidate.getId(),
        expectedRegistrationId,
        expectedRegistrationFence);
    boolean matches = codec.matchesRegistration(
        storedChallenge,
        current.getId(),
        expectedRegistrationId,
        email,
        presentedCode);
    String claimToken = UUID.randomUUID().toString();
    ClaimResult claim = redis(() -> store.claimChallenge(
        emailKey,
        storedChallenge,
        matches,
        claimToken));

    if (claim.status() != ClaimStatus.CLAIMED) {
      throw mapClaimFailure(claim);
    }

    AuthUser verified;
    try {
      verified = accounts.verifyPending(
          email,
          current.getId(),
          expectedRegistrationId,
          expectedRegistrationFence,
          clock.instant());
    } catch (RegistrationVerificationRejectedException rejected) {
      finalizeRejectedClaim(emailKey, storedChallenge, claimToken);
      throw invalidOtp();
    } catch (RuntimeException databaseFailure) {
      throw new AuthBusinessException(
          "ACCOUNT_VERIFICATION_UNAVAILABLE",
          "Account verification is temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      if (!store.finalizeClaim(emailKey, storedChallenge, claimToken)) {
        log.warn("OTP claim finalization was not acknowledged after account verification");
      }
    } catch (RuntimeException finalizeFailure) {
      log.warn("OTP claim finalization failed after account verification; challenge will expire");
    }
    return verified;
  }

  private AuthUser requireCurrentFlow(
      String email,
      UUID expectedUserId,
      UUID expectedRegistrationId,
      long expectedRegistrationFence) {
    try {
      return accounts.find(email)
          .filter(user -> !user.isVerified())
          .filter(user -> expectedUserId.equals(user.getId()))
          .filter(user -> Objects.equals(
              expectedRegistrationId, user.getRegistrationId()))
          .filter(user -> expectedRegistrationFence == user.getRegistrationFence())
          .orElseThrow(RegistrationVerificationRejectedException::new);
    } catch (RegistrationVerificationRejectedException rejected) {
      throw invalidOtp();
    } catch (RuntimeException databaseFailure) {
      throw new AuthBusinessException(
          "ACCOUNT_VERIFICATION_UNAVAILABLE",
          "Account verification is temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private AuthBusinessException mapClaimFailure(ClaimResult claim) {
    return switch (claim.status()) {
      case BLOCKED -> throttled(
          "OTP_VERIFICATION_BLOCKED",
          "OTP verification is temporarily blocked",
          retrySeconds(claim.retryAfter()));
      case CLAIM_IN_PROGRESS -> throttled(
          "OTP_VERIFICATION_IN_PROGRESS",
          "OTP verification is already in progress",
          retrySeconds(claim.retryAfter()));
      case INVALID, MISSING, STALE -> invalidOtp();
      case CLAIMED -> throw new IllegalStateException("claimed OTP cannot be mapped as a failure");
    };
  }

  private void finalizeRejectedClaim(
      String emailKey,
      String storedChallenge,
      String claimToken) {
    try {
      store.finalizeClaim(emailKey, storedChallenge, claimToken);
    } catch (RuntimeException finalizeFailure) {
      log.warn("Rejected OTP claim cleanup failed; the challenge will expire automatically");
    }
  }

  private <T> T redis(RedisOperation<T> operation) {
    try {
      return operation.run();
    } catch (RuntimeException infrastructureFailure) {
      throw new AuthBusinessException(
          "OTP_STORE_UNAVAILABLE",
          "Verification service is temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private AuthBusinessException invalidOtp() {
    return new AuthBusinessException(
        "OTP_INVALID_OR_EXPIRED",
        "Verification code is invalid or expired",
        HttpStatus.BAD_REQUEST);
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

  private static long retrySeconds(Duration duration) {
    long milliseconds = Math.max(1, duration.toMillis());
    return Math.max(1, (milliseconds + 999) / 1000);
  }

  @FunctionalInterface
  private interface RedisOperation<T> {
    T run();
  }
}
