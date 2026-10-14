package com.recruitment.auth.service.registration;

import com.recruitment.auth.config.properties.OtpProperties;
import com.recruitment.auth.dto.registration.OtpDispatchResponse;
import com.recruitment.auth.dto.registration.RegisterRequest;
import com.recruitment.auth.dto.registration.RegistrationResponse;
import com.recruitment.auth.dto.registration.ResendOtpRequest;
import com.recruitment.auth.dto.registration.VerifyOtpRequest;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.security.password.RegistrationPasswordPolicy;
import com.recruitment.auth.service.registration.RegistrationAccountStore.RegistrationAccount;
import com.recruitment.auth.service.registration.RegistrationOtpDeliveryService.DispatchPlan;
import com.recruitment.auth.service.registration.RegistrationOtpDeliveryService.DispatchResult;
import com.recruitment.auth.service.token.TokenSessionService;
import com.recruitment.auth.support.IdentityNormalizer;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class RegistrationService {
  private final RegistrationAccountStore accounts;
  private final RegistrationPasswordPolicy passwordPolicy;
  private final PasswordEncoder passwordEncoder;
  private final RegistrationOtpDeliveryService otpDelivery;
  private final RegistrationOtpVerificationService otpVerification;
  private final OtpProperties otpProperties;
  private final TokenSessionService tokenSessions;

  public RegistrationService(
      RegistrationAccountStore accounts,
      RegistrationPasswordPolicy passwordPolicy,
      PasswordEncoder passwordEncoder,
      RegistrationOtpDeliveryService otpDelivery,
      RegistrationOtpVerificationService otpVerification,
      OtpProperties otpProperties,
      TokenSessionService tokenSessions) {
    this.accounts = accounts;
    this.passwordPolicy = passwordPolicy;
    this.passwordEncoder = passwordEncoder;
    this.otpDelivery = otpDelivery;
    this.otpVerification = otpVerification;
    this.otpProperties = otpProperties;
    this.tokenSessions = tokenSessions;
  }

  public RegistrationResponse register(RegisterRequest request) {
    String email = normalizeEmail(request.email());
    passwordPolicy.validate(request.password());
    if (request.role() == null) {
      throw new AuthBusinessException(
          "REGISTRATION_ROLE_INVALID",
          "Registration role must be CANDIDATE or RECRUITER",
          HttpStatus.BAD_REQUEST);
    }
    String passwordHash = passwordEncoder.encode(request.password());

    DispatchResult dispatch = otpDelivery.dispatch(
            email,
            () -> prepareRegistration(
                email,
                passwordHash,
                request.role().toUserRole()))
        .orElseThrow(() -> new IllegalStateException("registration dispatch plan was empty"));
    return new RegistrationResponse(
        dispatch.resend() ? "OTP_RESENT" : "OTP_REQUIRED",
        dispatch.expiresInSeconds(),
        dispatch.user().getRegistrationId());
  }

  public OtpDispatchResponse resend(ResendOtpRequest request) {
    String email = normalizeEmail(request.email());
    Optional<DispatchResult> dispatch = otpDelivery.dispatch(email, () -> {
      Optional<AuthUser> existing = find(email);
      if (existing.isEmpty()) {
        return Optional.empty();
      }
      AuthUser pending = existing.orElseThrow();
      if (pending.isVerified()
          || !Objects.equals(pending.getRegistrationId(), request.registrationId())) {
        return Optional.empty();
      }
      UUID registrationId = pending.getRegistrationId();
      long registrationFence = pending.getRegistrationFence();
      UUID userId = pending.getId();
      Supplier<AuthUser> current = () -> requireCurrentRegistration(
          email, userId, registrationId, registrationFence);
      return Optional.of(new DispatchPlan(
          registrationId,
          registrationFence,
          true,
          current,
          current));
    });

    return new OtpDispatchResponse(
        "OTP_SENT_IF_ELIGIBLE",
        dispatch.map(DispatchResult::expiresInSeconds)
            .orElseGet(() -> otpProperties.ttl().toSeconds()));
  }

  public AuthTokenResponse verify(VerifyOtpRequest request) {
    String email = normalizeEmail(request.email());
    UUID registrationId = request.registrationId();
    AuthUser pending = find(email)
        .filter(user -> !user.isVerified())
        .filter(user -> Objects.equals(user.getRegistrationId(), registrationId))
        .orElseThrow(this::invalidOtp);
    AuthUser verified = otpVerification.verify(pending, registrationId, request.otp());
    return tokenSessions.issueForVerifiedUser(verified.getId());
  }

  private Optional<DispatchPlan> prepareRegistration(
      String email,
      String passwordHash,
      UserRole role) {
    Optional<AuthUser> existing = find(email);
    if (existing.filter(AuthUser::isVerified).isPresent()) {
      throw emailAlreadyRegistered();
    }

    long registrationFence = nextRegistrationFence();
    AuthUser draft = AuthUser.registerLocal(
        email, passwordHash, role, registrationFence);
    UUID registrationId = draft.getRegistrationId();
    return Optional.of(new DispatchPlan(
        registrationId,
        registrationFence,
        existing.isPresent(),
        () -> persistRegistration(draft),
        () -> requireCurrentRegistration(
            email, null, registrationId, registrationFence)));
  }

  private AuthUser persistRegistration(AuthUser draft) {
    RegistrationAccount account;
    try {
      account = accounts.upsertPending(draft);
    } catch (DataAccessException | IllegalStateException exception) {
      throw accountStoreUnavailable();
    }
    if (!account.accepted()) {
      if (account.user().isVerified()) {
        throw emailAlreadyRegistered();
      }
      throw accountStoreUnavailable();
    }
    return account.user();
  }

  private AuthUser requireCurrentRegistration(
      String email,
      UUID expectedUserId,
      UUID registrationId,
      long registrationFence) {
    return find(email)
        .filter(user -> !user.isVerified())
        .filter(user -> expectedUserId == null || expectedUserId.equals(user.getId()))
        .filter(user -> Objects.equals(registrationId, user.getRegistrationId()))
        .filter(user -> registrationFence == user.getRegistrationFence())
        .orElseThrow(this::accountStoreUnavailable);
  }

  private long nextRegistrationFence() {
    try {
      return accounts.nextRegistrationFence();
    } catch (DataAccessException | IllegalStateException exception) {
      throw accountStoreUnavailable();
    }
  }

  private Optional<AuthUser> find(String normalizedEmail) {
    try {
      return accounts.find(normalizedEmail);
    } catch (DataAccessException exception) {
      throw accountStoreUnavailable();
    }
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

  private AuthBusinessException invalidOtp() {
    return new AuthBusinessException(
        "OTP_INVALID_OR_EXPIRED",
        "Verification code is invalid or expired",
        HttpStatus.BAD_REQUEST);
  }

  private AuthBusinessException emailAlreadyRegistered() {
    return new AuthBusinessException(
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email is already registered",
        HttpStatus.CONFLICT);
  }

  private AuthBusinessException accountStoreUnavailable() {
    return new AuthBusinessException(
        "ACCOUNT_STORE_UNAVAILABLE",
        "Account service is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE);
  }
}
