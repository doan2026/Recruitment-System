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

@Entity
@Table(name = "refresh_sessions", schema = "auth")
public class RefreshSession {
  @Id
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "family_id", nullable = false)
  private UUID familyId;

  @Column(name = "parent_session_id")
  private UUID parentSessionId;

  @Column(name = "token_hash", nullable = false, length = 64)
  private String tokenHash;

  @Column(name = "issued_at", nullable = false, updatable = false)
  private Instant issuedAt;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Column(name = "consumed_at")
  private Instant consumedAt;

  @Column(name = "revoked_at")
  private Instant revokedAt;

  @Enumerated(EnumType.STRING)
  @Column(name = "revocation_reason", length = 32)
  private RefreshSessionRevocationReason revocationReason;

  @Version
  @Column(nullable = false)
  private long version;

  protected RefreshSession() {}

  private RefreshSession(
      UUID userId,
      UUID familyId,
      UUID parentSessionId,
      String tokenHash,
      Instant issuedAt,
      Instant expiresAt) {
    this.id = UUID.randomUUID();
    this.userId = Objects.requireNonNull(userId, "userId is required");
    this.familyId = Objects.requireNonNull(familyId, "familyId is required");
    this.parentSessionId = parentSessionId;
    this.tokenHash = IdentityNormalizer.requireSha256Hex(tokenHash);
    this.issuedAt = Objects.requireNonNull(issuedAt, "issuedAt is required");
    this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt is required");
    validateState();
  }

  public static RefreshSession issue(
      UUID userId, String tokenHash, Instant issuedAt, Instant expiresAt) {
    return new RefreshSession(
        userId,
        UUID.randomUUID(),
        null,
        tokenHash,
        issuedAt,
        expiresAt);
  }

  public RefreshSession rotate(String nextTokenHash, Instant at, Instant nextExpiresAt) {
    if (tokenHash.equals(nextTokenHash)) {
      throw new IllegalArgumentException("rotation must issue a different token hash");
    }
    RefreshSession child = new RefreshSession(
        userId,
        familyId,
        id,
        nextTokenHash,
        at,
        nextExpiresAt);
    consume(at);
    return child;
  }

  public void consume(Instant at) {
    Instant consumedTime = Objects.requireNonNull(at, "consumed time is required");
    if (!isUsableAt(consumedTime)) {
      throw new IllegalStateException("refresh session is not usable");
    }
    consumedAt = consumedTime;
  }

  public void revoke(RefreshSessionRevocationReason reason, Instant at) {
    Objects.requireNonNull(reason, "revocation reason is required");
    Instant revokedTime = Objects.requireNonNull(at, "revocation time is required");
    if (revokedTime.isBefore(issuedAt)) {
      throw new IllegalArgumentException("revocation time cannot precede issue time");
    }
    revokedAt = revokedTime;
    revocationReason = reason;
  }

  public boolean isUsableAt(Instant at) {
    Objects.requireNonNull(at, "time is required");
    return consumedAt == null && revokedAt == null && !at.isBefore(issuedAt) && at.isBefore(expiresAt);
  }

  @PrePersist
  @PreUpdate
  void validateState() {
    userId = Objects.requireNonNull(userId, "userId is required");
    familyId = Objects.requireNonNull(familyId, "familyId is required");
    tokenHash = IdentityNormalizer.requireSha256Hex(tokenHash);
    issuedAt = Objects.requireNonNull(issuedAt, "issuedAt is required");
    expiresAt = Objects.requireNonNull(expiresAt, "expiresAt is required");
    if (!expiresAt.isAfter(issuedAt)) {
      throw new IllegalArgumentException("expiresAt must be after issuedAt");
    }
    if (parentSessionId != null && parentSessionId.equals(id)) {
      throw new IllegalArgumentException("refresh session cannot be its own parent");
    }
    if (consumedAt != null && (consumedAt.isBefore(issuedAt) || !consumedAt.isBefore(expiresAt))) {
      throw new IllegalArgumentException("consumedAt must be within the session lifetime");
    }
    if (revokedAt != null && revokedAt.isBefore(issuedAt)) {
      throw new IllegalArgumentException("revokedAt cannot precede issuedAt");
    }
    if ((revokedAt == null) != (revocationReason == null)) {
      throw new IllegalStateException("revokedAt and revocationReason must change together");
    }
  }

  public UUID getId() {
    return id;
  }

  public UUID getUserId() {
    return userId;
  }

  public UUID getFamilyId() {
    return familyId;
  }

  public UUID getParentSessionId() {
    return parentSessionId;
  }

  public String getTokenHash() {
    return tokenHash;
  }

  public Instant getIssuedAt() {
    return issuedAt;
  }

  public Instant getExpiresAt() {
    return expiresAt;
  }

  public Instant getConsumedAt() {
    return consumedAt;
  }

  public Instant getRevokedAt() {
    return revokedAt;
  }

  public RefreshSessionRevocationReason getRevocationReason() {
    return revocationReason;
  }

  public long getVersion() {
    return version;
  }
}
