package com.recruitment.auth.service.registration;

import com.recruitment.auth.exception.RegistrationVerificationRejectedException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RegistrationAccountStore {
  private final AuthUserRepository users;

  public RegistrationAccountStore(AuthUserRepository users) {
    this.users = users;
  }

  @Transactional(timeout = 10)
  public long nextRegistrationFence() {
    long fence = users.nextRegistrationFence();
    if (fence <= 0) {
      throw new IllegalStateException("registration fence sequence returned a non-positive value");
    }
    return fence;
  }

  @Transactional(timeout = 10)
  public RegistrationAccount upsertPending(AuthUser draft) {
    AuthUser pending = Objects.requireNonNull(draft, "draft is required");
    if (pending.isVerified()
        || pending.getRegistrationId() == null
        || pending.getRegistrationFence() <= 0) {
      throw new IllegalArgumentException(
          "draft must be an unverified registration flow with a positive fence");
    }
    int mutated = users.upsertPendingRegistration(
        pending.getId(),
        pending.getEmail(),
        pending.getNormalizedEmail(),
        pending.getPasswordHash(),
        pending.getRole().name(),
        pending.getRegistrationId(),
        pending.getRegistrationFence());
    AuthUser stored = users.findByNormalizedEmail(pending.getNormalizedEmail())
        .orElseThrow(() -> new IllegalStateException("registered account could not be loaded"));
    boolean accepted = mutated == 1
        && !stored.isVerified()
        && pending.getRegistrationId().equals(stored.getRegistrationId())
        && pending.getRegistrationFence() == stored.getRegistrationFence();
    boolean created = accepted && pending.getId().equals(stored.getId());
    return new RegistrationAccount(stored, accepted, created);
  }

  @Transactional(readOnly = true)
  public Optional<AuthUser> find(String normalizedEmail) {
    return users.findByNormalizedEmail(normalizedEmail);
  }

  @Transactional(timeout = 10)
  public AuthUser verifyPending(
      String normalizedEmail,
      UUID expectedUserId,
      UUID expectedRegistrationId,
      long expectedRegistrationFence,
      Instant verifiedAt) {
    AuthUser user = users.findByNormalizedEmailForUpdate(normalizedEmail)
        .orElseThrow(RegistrationVerificationRejectedException::new);
    if (!user.getId().equals(expectedUserId)
        || !Objects.equals(user.getRegistrationId(), expectedRegistrationId)
        || user.getRegistrationFence() != expectedRegistrationFence
        || user.isVerified()) {
      throw new RegistrationVerificationRejectedException();
    }
    user.verify(verifiedAt);
    users.flush();
    return user;
  }

  public record RegistrationAccount(AuthUser user, boolean accepted, boolean created) {
    public RegistrationAccount {
      Objects.requireNonNull(user, "user is required");
    }
  }
}
