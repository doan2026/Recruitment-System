package com.recruitment.auth.identity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "users", schema = "auth")
public class AuthUser {
  private static final Pattern BCRYPT_COST_10 =
      Pattern.compile("^[$]2[aby][$]10[$][./A-Za-z0-9]{53}$");

  @Id
  private UUID id;

  @Column(nullable = false, length = 320)
  private String email;

  @Column(name = "normalized_email", nullable = false, length = 320)
  private String normalizedEmail;

  @Column(name = "password_hash", length = 255)
  private String passwordHash;

  @Column(name = "registration_id")
  private UUID registrationId;

  @Column(name = "registration_fence", nullable = false)
  private long registrationFence;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private UserRole role;

  @Column(name = "is_verified", nullable = false)
  private boolean verified;

  @Column(name = "verified_at")
  private Instant verifiedAt;

  @Column(name = "is_locked", nullable = false)
  private boolean locked;

  @Column(name = "locked_at")
  private Instant lockedAt;

  @Column(name = "locked_reason", length = 500)
  private String lockedReason;

  @Version
  @Column(nullable = false)
  private long version;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected AuthUser() {}

  private AuthUser(
      String email,
      String passwordHash,
      UserRole role,
      boolean verified,
      Instant verifiedAt,
      UUID registrationId,
      long registrationFence) {
    this.id = UUID.randomUUID();
    setEmail(email);
    this.passwordHash = passwordHash == null ? null : requirePasswordHash(passwordHash);
    this.role = Objects.requireNonNull(role, "role is required");
    this.verified = verified;
    this.verifiedAt = verifiedAt;
    this.registrationId = registrationId;
    this.registrationFence = requireRegistrationFence(registrationFence);
  }

  public static AuthUser registerLocal(String email, String passwordHash, UserRole role) {
    return registerLocal(email, passwordHash, role, 0);
  }

  public static AuthUser registerLocal(
      String email, String passwordHash, UserRole role, long registrationFence) {
    return new AuthUser(
        email,
        requirePasswordHash(passwordHash),
        requireSelfRegistrationRole(role),
        false,
        null,
        UUID.randomUUID(),
        registrationFence);
  }

  public static AuthUser registerOAuth(String email, Instant verifiedAt) {
    return registerOAuth(email, UserRole.CANDIDATE, verifiedAt);
  }

  public static AuthUser registerOAuth(String email, UserRole role, Instant verifiedAt) {
    return new AuthUser(
        email,
        null,
        requireSelfRegistrationRole(role),
        true,
        Objects.requireNonNull(verifiedAt, "verifiedAt is required"),
        null,
        0);
  }

  public void verify(Instant at) {
    if (!verified) {
      Instant verificationTime = Objects.requireNonNull(at, "verification time is required");
      verified = true;
      verifiedAt = verificationTime;
      registrationId = null;
    }
  }

  public void lock(String reason, Instant at) {
    String lockReason = IdentityNormalizer.requireText(reason, "lockedReason", 500);
    Instant lockTime = Objects.requireNonNull(at, "lock time is required");
    locked = true;
    lockedAt = lockTime;
    lockedReason = lockReason;
  }

  public void unlock() {
    locked = false;
    lockedAt = null;
    lockedReason = null;
  }

  public void changePasswordHash(String newPasswordHash) {
    passwordHash = requirePasswordHash(newPasswordHash);
  }

  @PrePersist
  @PreUpdate
  void validateState() {
    setEmail(email);
    role = Objects.requireNonNull(role, "role is required");
    if (passwordHash != null) {
      passwordHash = requirePasswordHash(passwordHash);
    }
    if (verified != (verifiedAt != null)) {
      throw new IllegalStateException("verified and verifiedAt must change together");
    }
    if (verified == (registrationId != null)) {
      throw new IllegalStateException(
          "only an unverified account may retain a registrationId");
    }
    registrationFence = requireRegistrationFence(registrationFence);
    if ((locked && (lockedAt == null || lockedReason == null))
        || (!locked && (lockedAt != null || lockedReason != null))) {
      throw new IllegalStateException("locked, lockedAt and lockedReason must change together");
    }
  }

  private void setEmail(String value) {
    String normalized = IdentityNormalizer.normalizeEmail(value);
    email = normalized;
    normalizedEmail = normalized;
  }

  private static String requirePasswordHash(String value) {
    String hash = IdentityNormalizer.requireText(value, "passwordHash", 255);
    if (!BCRYPT_COST_10.matcher(hash).matches()) {
      throw new IllegalArgumentException("passwordHash must be a bcrypt cost-10 hash");
    }
    return hash;
  }

  private static long requireRegistrationFence(long value) {
    if (value < 0) {
      throw new IllegalArgumentException("registrationFence cannot be negative");
    }
    return value;
  }

  private static UserRole requireSelfRegistrationRole(UserRole role) {
    UserRole registrationRole = Objects.requireNonNull(role, "role is required");
    if (registrationRole == UserRole.ADMIN) {
      throw new IllegalArgumentException("ADMIN cannot be created through self-registration");
    }
    return registrationRole;
  }

  public UUID getId() {
    return id;
  }

  public String getEmail() {
    return email;
  }

  public String getNormalizedEmail() {
    return normalizedEmail;
  }

  public String getPasswordHash() {
    return passwordHash;
  }

  public UUID getRegistrationId() {
    return registrationId;
  }

  public long getRegistrationFence() {
    return registrationFence;
  }

  public UserRole getRole() {
    return role;
  }

  public boolean isVerified() {
    return verified;
  }

  public Instant getVerifiedAt() {
    return verifiedAt;
  }

  public boolean isLocked() {
    return locked;
  }

  public Instant getLockedAt() {
    return lockedAt;
  }

  public String getLockedReason() {
    return lockedReason;
  }

  public long getVersion() {
    return version;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
