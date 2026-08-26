package com.recruitment.auth.passwordreset;

import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.RefreshSession;
import com.recruitment.auth.identity.RefreshSessionRepository;
import com.recruitment.auth.identity.RefreshSessionRevocationReason;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordResetTransactions {
  private final AuthUserRepository users;
  private final RefreshSessionRepository sessions;

  public PasswordResetTransactions(
      AuthUserRepository users,
      RefreshSessionRepository sessions) {
    this.users = users;
    this.sessions = sessions;
  }

  @Transactional(timeout = 10)
  public ResetAccount reset(
      UUID userId,
      long expectedUserVersion,
      String newPasswordHash,
      Instant resetAt) {
    UUID safeUserId = Objects.requireNonNull(userId, "userId is required");
    if (expectedUserVersion < 0) {
      throw new IllegalArgumentException("expectedUserVersion cannot be negative");
    }
    Instant now = Objects.requireNonNull(resetAt, "resetAt is required");
    AuthUser user = users.findByIdForUpdate(safeUserId)
        .orElseThrow(PasswordResetRejectedException::new);
    if (user.getVersion() != expectedUserVersion
        || !user.isVerified()
        || user.getPasswordHash() == null) {
      throw new PasswordResetRejectedException();
    }

    List<RefreshSession> changedSessions = new ArrayList<>();
    for (RefreshSession session :
        sessions.findAllByUserIdOrderByIssuedAtAsc(safeUserId)) {
      if (!session.isRevoked() && !session.isExpiredAt(now)) {
        session.revoke(RefreshSessionRevocationReason.PASSWORD_RESET, now);
        changedSessions.add(session);
      }
    }
    user.changePasswordHash(newPasswordHash);
    if (!changedSessions.isEmpty()) {
      sessions.saveAll(changedSessions);
    }
    users.flush();
    sessions.flush();
    return new ResetAccount(user.getNormalizedEmail());
  }

  public record ResetAccount(String normalizedEmail) {
    public ResetAccount {
      if (normalizedEmail == null || normalizedEmail.isBlank()) {
        throw new IllegalArgumentException("normalizedEmail is required");
      }
    }
  }
}
