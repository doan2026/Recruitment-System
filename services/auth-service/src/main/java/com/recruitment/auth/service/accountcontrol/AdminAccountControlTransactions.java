package com.recruitment.auth.service.accountcontrol;

import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.RefreshSessionRevocationReason;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.jpa.RefreshSessionRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminAccountControlTransactions {
  private final AuthUserRepository users;
  private final RefreshSessionRepository sessions;
  private final Clock clock;

  public AdminAccountControlTransactions(
      AuthUserRepository users,
      RefreshSessionRepository sessions,
      Clock clock) {
    this.users = users;
    this.sessions = sessions;
    this.clock = clock;
  }

  @Transactional(timeout = 10)
  public AccountControlResult update(
      UUID actorId,
      UUID targetUserId,
      boolean locked,
      String normalizedReason) {
    UUID safeActorId = Objects.requireNonNull(actorId, "actorId is required");
    UUID safeTargetId = Objects.requireNonNull(targetUserId, "targetUserId is required");

    List<AuthUser> lockedUsers = users.findAllByIdForUpdateOrdered(
        List.of(safeActorId, safeTargetId));
    Map<UUID, AuthUser> usersById = new HashMap<>();
    lockedUsers.forEach(user -> usersById.put(user.getId(), user));

    AuthUser actor = usersById.get(safeActorId);
    if (actor == null) {
      throw accessTokenInvalid();
    }
    requireDurableAdmin(actor);
    if (safeActorId.equals(safeTargetId)) {
      throw selfControlNotAllowed();
    }

    AuthUser target = usersById.get(safeTargetId);
    if (target == null) {
      throw userNotFound();
    }
    if (target.getRole() == UserRole.ADMIN) {
      throw adminTargetNotAllowed();
    }

    Instant now = clock.instant();
    int revokedSessionCount = 0;
    if (locked) {
      if (!target.isLocked()) {
        target.lock(normalizedReason, now);
      }
      revokedSessionCount = sessions.revokeActiveByUserId(
          safeTargetId, now, RefreshSessionRevocationReason.ADMIN_LOCK);
    } else if (target.isLocked()) {
      target.unlock();
    }

    users.flush();
    sessions.flush();
    return new AccountControlResult(
        target.getId(),
        target.isLocked(),
        target.getLockedAt(),
        target.getVersion(),
        revokedSessionCount);
  }

  private static void requireDurableAdmin(AuthUser actor) {
    if (!actor.isVerified()
        || actor.isLocked()
        || actor.getRole() != UserRole.ADMIN) {
      throw accessDenied();
    }
  }

  private static AuthBusinessException accessTokenInvalid() {
    return new AuthBusinessException(
        "ACCESS_TOKEN_INVALID",
        "Access token is no longer valid",
        HttpStatus.UNAUTHORIZED);
  }

  private static AuthBusinessException accessDenied() {
    return new AuthBusinessException(
        "ACCESS_DENIED",
        "Access is denied",
        HttpStatus.FORBIDDEN);
  }

  private static AuthBusinessException selfControlNotAllowed() {
    return new AuthBusinessException(
        "SELF_ACCOUNT_CONTROL_NOT_ALLOWED",
        "An administrator cannot change their own lock state",
        HttpStatus.CONFLICT);
  }

  private static AuthBusinessException userNotFound() {
    return new AuthBusinessException(
        "AUTH_USER_NOT_FOUND",
        "User was not found",
        HttpStatus.NOT_FOUND);
  }

  private static AuthBusinessException adminTargetNotAllowed() {
    return new AuthBusinessException(
        "ADMIN_ACCOUNT_CONTROL_NOT_ALLOWED",
        "Administrator accounts cannot be controlled by this endpoint",
        HttpStatus.FORBIDDEN);
  }

  public record AccountControlResult(
      UUID userId,
      boolean locked,
      Instant lockedAt,
      long version,
      int revokedSessionCount) {}
}
