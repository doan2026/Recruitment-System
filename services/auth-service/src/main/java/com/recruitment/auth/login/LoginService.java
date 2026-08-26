package com.recruitment.auth.login;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.IdentityNormalizer;
import com.recruitment.auth.login.LoginAttemptLimiter.AttemptDecision;
import com.recruitment.auth.login.LoginAttemptLimiter.State;
import com.recruitment.auth.login.api.LoginRequest;
import com.recruitment.auth.token.TokenSessionService;
import com.recruitment.auth.token.api.AuthTokenResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class LoginService {
  private static final int MAXIMUM_BCRYPT_PASSWORD_BYTES = 72;
  private static final String DUMMY_PASSWORD = "not-a-real-login-password-90210";
  private static final String DUMMY_BCRYPT_COST_10 =
      "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

  private final AuthUserRepository users;
  private final PasswordEncoder passwordEncoder;
  private final LoginAttemptLimiter attempts;
  private final TokenSessionService tokenSessions;

  public LoginService(
      AuthUserRepository users,
      PasswordEncoder passwordEncoder,
      LoginAttemptLimiter attempts,
      TokenSessionService tokenSessions) {
    this.users = users;
    this.passwordEncoder = passwordEncoder;
    this.attempts = attempts;
    this.tokenSessions = tokenSessions;
  }

  public AuthTokenResponse login(LoginRequest request) {
    String normalizedEmail = normalizeEmail(request.email());
    requireAllowed(preflight(normalizedEmail));

    Optional<AuthUser> optionalUser = find(normalizedEmail);
    AuthUser user = optionalUser.orElse(null);
    String observedPasswordHash = user == null ? null : user.getPasswordHash();
    if (!matches(request.password(), observedPasswordHash)) {
      rejectFailedCredential(recordFailure(normalizedEmail));
    }

    AttemptDecision completion = completeSuccessfulCredential(normalizedEmail);
    requireAllowed(completion);
    if (completion.state() != State.ALLOWED) {
      throw rateLimitUnavailable();
    }

    // A null local hash always takes the dummy bcrypt path above and cannot reach this branch.
    if (user == null || observedPasswordHash == null) {
      throw invalidCredentials();
    }
    if (!user.isVerified()) {
      throw new AuthBusinessException(
          "EMAIL_NOT_VERIFIED",
          "Email verification is required",
          HttpStatus.FORBIDDEN,
          Map.of("registrationId", user.getRegistrationId()));
    }
    if (user.isLocked()) {
      throw new AuthBusinessException(
          "ACCOUNT_LOCKED",
          "Account is locked",
          HttpStatus.FORBIDDEN);
    }
    return tokenSessions.issueForPasswordLogin(user.getId(), observedPasswordHash);
  }

  private boolean matches(String rawPassword, String passwordHash) {
    boolean supportedPassword = rawPassword != null
        && !rawPassword.isBlank()
        && rawPassword.getBytes(StandardCharsets.UTF_8).length
            <= MAXIMUM_BCRYPT_PASSWORD_BYTES;
    String passwordToCheck = supportedPassword ? rawPassword : DUMMY_PASSWORD;
    String hashToCheck = passwordHash == null ? DUMMY_BCRYPT_COST_10 : passwordHash;
    try {
      boolean matched = passwordEncoder.matches(passwordToCheck, hashToCheck);
      return supportedPassword && passwordHash != null && matched;
    } catch (IllegalArgumentException exception) {
      return false;
    }
  }

  private AttemptDecision preflight(String normalizedEmail) {
    try {
      AttemptDecision decision = attempts.preflight(normalizedEmail);
      if (decision == null || decision.state() == State.FAILED) {
        throw rateLimitUnavailable();
      }
      return decision;
    } catch (LoginAttemptStoreUnavailableException exception) {
      throw rateLimitUnavailable();
    }
  }

  private AttemptDecision recordFailure(String normalizedEmail) {
    try {
      AttemptDecision decision = attempts.recordFailure(normalizedEmail);
      if (decision == null || decision.state() == State.ALLOWED) {
        throw rateLimitUnavailable();
      }
      return decision;
    } catch (LoginAttemptStoreUnavailableException exception) {
      throw rateLimitUnavailable();
    }
  }

  private AttemptDecision completeSuccessfulCredential(String normalizedEmail) {
    try {
      return attempts.completeSuccessfulCredential(normalizedEmail);
    } catch (LoginAttemptStoreUnavailableException exception) {
      throw rateLimitUnavailable();
    }
  }

  private Optional<AuthUser> find(String normalizedEmail) {
    try {
      return users.findByNormalizedEmail(normalizedEmail);
    } catch (DataAccessException exception) {
      throw new AuthBusinessException(
          "ACCOUNT_STORE_UNAVAILABLE",
          "Account service is temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private String normalizeEmail(String email) {
    try {
      return IdentityNormalizer.normalizeEmail(email);
    } catch (IllegalArgumentException exception) {
      throw invalidCredentials();
    }
  }

  private void rejectFailedCredential(AttemptDecision decision) {
    if (decision.blocked()) {
      throw temporarilyBlocked(decision.retryAfter());
    }
    throw invalidCredentials();
  }

  private void requireAllowed(AttemptDecision decision) {
    if (decision.blocked()) {
      throw temporarilyBlocked(decision.retryAfter());
    }
  }

  private AuthBusinessException temporarilyBlocked(Duration retryAfter) {
    long retryAfterSeconds = ceilSeconds(retryAfter);
    return new AuthBusinessException(
        "LOGIN_TEMPORARILY_BLOCKED",
        "Too many failed login attempts",
        HttpStatus.TOO_MANY_REQUESTS,
        Map.of("retryAfterSeconds", retryAfterSeconds),
        retryAfterSeconds);
  }

  private AuthBusinessException invalidCredentials() {
    return new AuthBusinessException(
        "INVALID_CREDENTIALS",
        "Email or password is incorrect",
        HttpStatus.UNAUTHORIZED);
  }

  private AuthBusinessException rateLimitUnavailable() {
    return new AuthBusinessException(
        "LOGIN_RATE_LIMIT_UNAVAILABLE",
        "Login is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE);
  }

  private static long ceilSeconds(Duration duration) {
    long millis = duration.toMillis();
    return Math.max(1, millis / 1000 + (millis % 1000 == 0 ? 0 : 1));
  }
}
