package com.recruitment.auth.service.oauth;

import com.recruitment.auth.dto.oauth.GoogleOAuthExchangeRequest;
import com.recruitment.auth.dto.oauth.GoogleOAuthRole;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.repository.redis.oauth.GoogleOAuthExchangeStore;
import com.recruitment.auth.service.token.TokenSessionService;
import java.util.Objects;
import java.util.UUID;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class GoogleOAuthExchangeService {
  private final GoogleOAuthExchangeStore exchanges;
  private final GoogleOAuthAccountResolver accounts;
  private final TokenSessionService sessions;

  public GoogleOAuthExchangeService(
      GoogleOAuthExchangeStore exchanges,
      GoogleOAuthAccountResolver accounts,
      TokenSessionService sessions) {
    this.exchanges = Objects.requireNonNull(exchanges, "exchanges are required");
    this.accounts = Objects.requireNonNull(accounts, "accounts are required");
    this.sessions = Objects.requireNonNull(sessions, "sessions are required");
  }

  public AuthTokenResponse exchange(GoogleOAuthExchangeRequest request, String binder) {
    GoogleOAuthExchangeRequest safeRequest = Objects.requireNonNull(request, "request is required");
    GoogleOAuthExchangeStore.VerifiedExchange verified;
    try {
      verified = exchanges.consume(safeRequest.code(), binder)
          .orElseThrow(GoogleOAuthExchangeService::invalidExchange);
    } catch (DataAccessException unavailable) {
      throw unavailable();
    }

    GoogleOAuthRole role = verified.role() == null ? safeRequest.role() : verified.role();
    if (verified.role() != null && safeRequest.role() != null && safeRequest.role() != verified.role()) {
      throw new AuthBusinessException("GOOGLE_ROLE_MISMATCH", "Restart Google sign-in from the correct portal", HttpStatus.FORBIDDEN);
    }

    UUID userId;
    try {
      userId = accounts.resolveOrCreate(verified.identity(), role);
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
