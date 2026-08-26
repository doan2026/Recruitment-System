package com.recruitment.auth.oauth;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.token.TokenSessionService;
import com.recruitment.auth.token.api.AuthTokenResponse;
import java.util.Objects;
import java.util.UUID;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class GoogleOAuthExchangeService {
  private final GoogleOAuthExchangeStore exchanges;
  private final GoogleOAuthAccountResolver accounts;
  private final TokenSessionService sessions;

  GoogleOAuthExchangeService(
      GoogleOAuthExchangeStore exchanges,
      GoogleOAuthAccountResolver accounts,
      TokenSessionService sessions) {
    this.exchanges = Objects.requireNonNull(exchanges, "exchanges are required");
    this.accounts = Objects.requireNonNull(accounts, "accounts are required");
    this.sessions = Objects.requireNonNull(sessions, "sessions are required");
  }

  AuthTokenResponse exchange(GoogleOAuthExchangeRequest request, String binder) {
    GoogleOAuthExchangeRequest safeRequest = Objects.requireNonNull(request, "request is required");
    GoogleOAuthIdentity identity;
    try {
      identity = exchanges.consume(safeRequest.code(), binder)
          .orElseThrow(GoogleOAuthExchangeService::invalidExchange);
    } catch (DataAccessException unavailable) {
      throw unavailable();
    }

    UUID userId;
    try {
      userId = accounts.resolveOrCreate(identity, safeRequest.role());
    } catch (AuthBusinessException expected) {
      throw expected;
    } catch (DataIntegrityViolationException | ConcurrencyFailureException collision) {
      throw retryLogin();
    } catch (DataAccessException databaseUnavailable) {
      throw unavailable();
    }
    return sessions.issueForVerifiedUser(userId);
  }

  private static AuthBusinessException invalidExchange() {
    return new AuthBusinessException(
        "GOOGLE_EXCHANGE_INVALID",
        "Google sign-in exchange is invalid or expired",
        HttpStatus.UNAUTHORIZED);
  }

  private static AuthBusinessException retryLogin() {
    return new AuthBusinessException(
        "GOOGLE_LOGIN_RETRY",
        "Google sign-in could not be completed; restart the sign-in flow",
        HttpStatus.CONFLICT);
  }

  private static AuthBusinessException unavailable() {
    return new AuthBusinessException(
        "GOOGLE_LOGIN_UNAVAILABLE",
        "Google sign-in is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE);
  }
}
