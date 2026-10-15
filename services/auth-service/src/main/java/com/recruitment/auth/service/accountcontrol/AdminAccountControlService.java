package com.recruitment.auth.service.accountcontrol;

import com.recruitment.auth.dto.accountcontrol.AccountLockResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.service.accountcontrol.AdminAccountControlTransactions.AccountControlResult;
import java.text.Normalizer;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;

@Service
public class AdminAccountControlService {
  private static final int MAX_REASON_LENGTH = 500;

  private final AdminAccountControlTransactions transactions;

  public AdminAccountControlService(AdminAccountControlTransactions transactions) {
    this.transactions = transactions;
  }

  public AccountLockResponse update(
      UUID actorId,
      UUID targetUserId,
      Boolean locked,
      String reason) {
    UUID safeActorId = Objects.requireNonNull(actorId, "actorId is required");
    UUID safeTargetId = Objects.requireNonNull(targetUserId, "targetUserId is required");
    boolean desiredLock = requireLocked(locked);
    String normalizedReason = validateReason(desiredLock, reason);

    try {
      AccountControlResult result = transactions.update(
          safeActorId,
          safeTargetId,
          desiredLock,
          normalizedReason);
      return new AccountLockResponse(
          result.userId(),
          result.locked(),
          result.lockedAt(),
          result.version(),
          result.revokedSessionCount());
    } catch (DataAccessException | TransactionException unavailable) {
      throw unavailable();
    }
  }

  private static boolean requireLocked(Boolean locked) {
    if (locked == null) {
      throw validation("locked", "locked is required");
    }
    return locked;
  }

  private static String validateReason(boolean locked, String reason) {
    String normalized = normalizeReason(reason);
    if (locked) {
      if (normalized == null
          || normalized.isEmpty()
          || normalized.length() > MAX_REASON_LENGTH
          || containsUnsafeFormatting(normalized)) {
        throw validation(
            "reason",
            "reason must contain between 1 and 500 safe characters when locking an account");
      }
      return normalized;
    }
    if (normalized != null && !normalized.isEmpty()) {
      throw validation("reason", "reason must be omitted when unlocking an account");
    }
    return null;
  }

  private static String normalizeReason(String reason) {
    if (reason == null) {
      return null;
    }
    String normalized = Normalizer.normalize(reason, Normalizer.Form.NFC);
    int start = 0;
    int end = normalized.length();
    while (start < end) {
      int codePoint = normalized.codePointAt(start);
      if (!isUnicodeSpace(codePoint)) {
        break;
      }
      start += Character.charCount(codePoint);
    }
    while (end > start) {
      int codePoint = normalized.codePointBefore(end);
      if (!isUnicodeSpace(codePoint)) {
        break;
      }
      end -= Character.charCount(codePoint);
    }
    return normalized.substring(start, end);
  }

  private static boolean isUnicodeSpace(int codePoint) {
    return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint);
  }

  private static boolean containsUnsafeFormatting(String value) {
    return value.codePoints().anyMatch(codePoint -> {
      int type = Character.getType(codePoint);
      return type == Character.CONTROL
          || type == Character.FORMAT
          || type == Character.LINE_SEPARATOR
          || type == Character.PARAGRAPH_SEPARATOR;
    });
  }

  private static AuthBusinessException validation(String field, String message) {
    return new AuthBusinessException(
        "VALIDATION_ERROR",
        "Request validation failed",
        HttpStatus.BAD_REQUEST,
        Map.of(field, message));
  }

  private static AuthBusinessException unavailable() {
    return new AuthBusinessException(
        "ACCOUNT_CONTROL_UNAVAILABLE",
        "Account control is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE);
  }
}
