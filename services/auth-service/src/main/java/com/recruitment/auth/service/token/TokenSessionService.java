package com.recruitment.auth.service.token;

import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.security.token.RefreshTokenCodec;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class TokenSessionService {
  private final RefreshTokenCodec refreshTokens;
  private final TokenSessionTransactions transactions;

  TokenSessionService(
      RefreshTokenCodec refreshTokens, TokenSessionTransactions transactions) {
    this.refreshTokens = refreshTokens;
    this.transactions = transactions;
  }

  public AuthTokenResponse issueForPasswordLogin(
      UUID userId, String expectedPasswordHash) {
    if (userId == null || expectedPasswordHash == null || expectedPasswordHash.isBlank()) {
      throw new AuthBusinessException(
          "INVALID_CREDENTIALS",
          "Email or password is incorrect",
          HttpStatus.UNAUTHORIZED);
    }
    return transactions.issueForPasswordLogin(userId, expectedPasswordHash);
  }

  public AuthTokenResponse issueForVerifiedUser(UUID userId) {
    if (userId == null) {
      throw new AuthBusinessException(
          "AUTHENTICATION_FAILED",
          "Authentication could not be completed",
          HttpStatus.UNAUTHORIZED);
    }
    return transactions.issueForVerifiedUser(userId);
  }

  public AuthTokenResponse refresh(String rawRefreshToken) {
    String hash = refreshTokens.hashPresented(rawRefreshToken)
        .orElseThrow(TokenSessionService::invalidRefresh);
    return transactions.refresh(hash).valueOrThrow();
  }

  public void logout(String rawRefreshToken) {
    String hash = refreshTokens.hashPresented(rawRefreshToken)
        .orElseThrow(TokenSessionService::invalidRefresh);
    transactions.logout(hash).valueOrThrow();
  }

  private static AuthBusinessException invalidRefresh() {
    return new AuthBusinessException(
        "REFRESH_TOKEN_INVALID_OR_EXPIRED",
        "Refresh token is invalid or expired",
        HttpStatus.UNAUTHORIZED);
  }
}
