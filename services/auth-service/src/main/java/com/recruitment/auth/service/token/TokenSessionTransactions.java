package com.recruitment.auth.service.token;

import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.RefreshSession;
import com.recruitment.auth.model.RefreshSessionRevocationReason;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.jpa.RefreshSessionRepository;
import com.recruitment.auth.security.token.JwtTokenService;
import com.recruitment.auth.security.token.RefreshTokenCodec.Material;
import com.recruitment.auth.security.token.RefreshTokenCodec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class TokenSessionTransactions {
  static final Duration REFRESH_FAMILY_LIFETIME = Duration.ofDays(7);

  private final AuthUserRepository users;
  private final RefreshSessionRepository sessions;
  private final JwtTokenService jwtTokens;
  private final RefreshTokenCodec refreshTokens;
  private final TokenTimeSource time;

  TokenSessionTransactions(
      AuthUserRepository users,
      RefreshSessionRepository sessions,
      JwtTokenService jwtTokens,
      RefreshTokenCodec refreshTokens,
      TokenTimeSource time) {
    this.users = users;
    this.sessions = sessions;
    this.jwtTokens = jwtTokens;
    this.refreshTokens = refreshTokens;
    this.time = time;
  }

  @Transactional
  public AuthTokenResponse issueForPasswordLogin(
      UUID userId, String expectedPasswordHash) {
    AuthUser user = users.findByIdForUpdate(userId).orElseThrow(
        TokenSessionTransactions::invalidCredentials);
    if (!constantTimeEquals(user.getPasswordHash(), expectedPasswordHash)) {
      throw invalidCredentials();
    }
    requireEligible(user);
    return issueNewFamily(user, time.now());
  }

  @Transactional
  public AuthTokenResponse issueForVerifiedUser(UUID userId) {
    AuthUser user = users.findByIdForUpdate(userId).orElseThrow(
        TokenSessionTransactions::authenticationFailed);
    requireEligible(user);
    return issueNewFamily(user, time.now());
  }

  @Transactional
  public TokenTransactionResult<AuthTokenResponse> refresh(String tokenHash) {
    UUID userId = sessions.findUserIdByTokenHash(tokenHash).orElse(null);
    if (userId == null) {
      return TokenTransactionResult.failure(invalidRefresh());
    }
    AuthUser user = users.findByIdForUpdate(userId).orElse(null);
    if (user == null) {
      return TokenTransactionResult.failure(invalidRefresh());
    }
    RefreshSession current = sessions.findByTokenHashForUpdate(tokenHash).orElse(null);
    if (current == null || !current.getUserId().equals(user.getId())) {
      return TokenTransactionResult.failure(invalidRefresh());
    }

    Instant now = time.now();
    if (current.isExpiredAt(now)) {
      if (!current.isRevoked()) {
        current.revoke(RefreshSessionRevocationReason.EXPIRED, now);
        sessions.saveAndFlush(current);
      }
      return TokenTransactionResult.failure(invalidRefresh());
    }
    if (current.isConsumed() || current.isRevoked()) {
      revokeAllActive(user.getId(), RefreshSessionRevocationReason.REUSE_DETECTED, now);
      return TokenTransactionResult.failure(invalidRefresh());
    }
    if (!user.isVerified()) {
      revokeAllActive(user.getId(), RefreshSessionRevocationReason.REUSE_DETECTED, now);
      return TokenTransactionResult.failure(authenticationFailed());
    }
    if (user.isLocked()) {
      revokeAllActive(user.getId(), RefreshSessionRevocationReason.ADMIN_LOCK, now);
      return TokenTransactionResult.failure(accountLocked());
    }

    Material replacement = refreshTokens.issue();
    RefreshSession child = current.rotate(
        replacement.tokenHash(), now, current.getExpiresAt());
    current.revoke(RefreshSessionRevocationReason.ROTATED, now);
    sessions.saveAllAndFlush(List.of(current, child));
    return TokenTransactionResult.success(
        response(user, replacement.rawToken(), child.getExpiresAt(), now));
  }

  @Transactional
  public TokenTransactionResult<Void> logout(String tokenHash) {
    UUID userId = sessions.findUserIdByTokenHash(tokenHash).orElse(null);
    if (userId == null) {
      return TokenTransactionResult.failure(invalidRefresh());
    }
    AuthUser user = users.findByIdForUpdate(userId).orElse(null);
    if (user == null) {
      return TokenTransactionResult.failure(invalidRefresh());
    }
    RefreshSession current = sessions.findByTokenHashForUpdate(tokenHash).orElse(null);
    if (current == null || !current.getUserId().equals(user.getId())) {
      return TokenTransactionResult.failure(invalidRefresh());
    }

    Instant now = time.now();
    if (current.isExpiredAt(now)) {
      if (!current.isRevoked()) {
        current.revoke(RefreshSessionRevocationReason.EXPIRED, now);
        sessions.saveAndFlush(current);
      }
      return TokenTransactionResult.failure(invalidRefresh());
    }
    if (current.isConsumed() || current.isRevoked()) {
      revokeAllActive(user.getId(), RefreshSessionRevocationReason.REUSE_DETECTED, now);
      return TokenTransactionResult.failure(invalidRefresh());
    }
    current.revoke(RefreshSessionRevocationReason.LOGOUT, now);
    sessions.saveAndFlush(current);
    return TokenTransactionResult.success(null);
  }

  private AuthTokenResponse issueNewFamily(AuthUser user, Instant now) {
    Material refresh = refreshTokens.issue();
    RefreshSession session = sessions.saveAndFlush(RefreshSession.issue(
        user.getId(), refresh.tokenHash(), now, now.plus(REFRESH_FAMILY_LIFETIME)));
    return response(user, refresh.rawToken(), session.getExpiresAt(), now);
  }

  private AuthTokenResponse response(
      AuthUser user, String rawRefreshToken, Instant refreshExpiresAt, Instant now) {
    JwtTokenService.IssuedAccessToken access = jwtTokens.issue(user, now);
    long refreshMillis = Duration.between(now, refreshExpiresAt).toMillis();
    long refreshSeconds = Math.max(1, (refreshMillis + 999) / 1000);
    return new AuthTokenResponse(
        access.value(),
        "Bearer",
        JwtTokenService.ACCESS_TOKEN_LIFETIME.toSeconds(),
        rawRefreshToken,
        refreshSeconds,
        new AuthTokenResponse.UserInfo(user.getId(), user.getEmail(), user.getRole()));
  }

  private void revokeAllActive(
      UUID userId, RefreshSessionRevocationReason reason, Instant now) {
    List<RefreshSession> all = sessions.findAllByUserIdOrderByIssuedAtAsc(userId);
    boolean changed = false;
    for (RefreshSession session : all) {
      if (!session.isRevoked() && !session.isExpiredAt(now)) {
        session.revoke(reason, now);
        changed = true;
      }
    }
    if (changed) {
      sessions.saveAllAndFlush(all);
    }
  }

  private static void requireEligible(AuthUser user) {
    if (!user.isVerified()) {
      throw new AuthBusinessException(
          "EMAIL_NOT_VERIFIED",
          "Email verification is required",
          HttpStatus.FORBIDDEN);
    }
    if (user.isLocked()) {
      throw accountLocked();
    }
  }

  private static boolean constantTimeEquals(String actual, String expected) {
    byte[] left = actual == null
        ? new byte[0]
        : actual.getBytes(StandardCharsets.US_ASCII);
    byte[] right = expected == null
        ? new byte[0]
        : expected.getBytes(StandardCharsets.US_ASCII);
    return MessageDigest.isEqual(left, right);
  }

  private static AuthBusinessException invalidCredentials() {
    return new AuthBusinessException(
        "INVALID_CREDENTIALS",
        "Email or password is incorrect",
        HttpStatus.UNAUTHORIZED);
  }

  private static AuthBusinessException authenticationFailed() {
    return new AuthBusinessException(
        "AUTHENTICATION_FAILED",
        "Authentication could not be completed",
        HttpStatus.UNAUTHORIZED);
  }

  private static AuthBusinessException accountLocked() {
    return new AuthBusinessException(
        "ACCOUNT_LOCKED",
        "Account is locked",
        HttpStatus.FORBIDDEN,
        Map.of());
  }

  private static AuthBusinessException invalidRefresh() {
    return new AuthBusinessException(
        "REFRESH_TOKEN_INVALID_OR_EXPIRED",
        "Refresh token is invalid or expired",
        HttpStatus.UNAUTHORIZED);
  }
}
