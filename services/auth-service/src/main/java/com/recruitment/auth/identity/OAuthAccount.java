package com.recruitment.auth.identity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "oauth_accounts", schema = "auth")
public class OAuthAccount {
  @Id
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private OAuthProvider provider;

  @Column(name = "provider_subject", nullable = false, length = 255)
  private String providerSubject;

  @Column(name = "provider_email", nullable = false, length = 320)
  private String providerEmail;

  @Column(name = "provider_email_verified", nullable = false)
  private boolean providerEmailVerified;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected OAuthAccount() {}

  private OAuthAccount(
      UUID userId,
      OAuthProvider provider,
      String providerSubject,
      String providerEmail,
      boolean providerEmailVerified) {
    this.id = UUID.randomUUID();
    this.userId = Objects.requireNonNull(userId, "userId is required");
    this.provider = Objects.requireNonNull(provider, "provider is required");
    this.providerSubject = IdentityNormalizer.requireText(providerSubject, "providerSubject", 255);
    this.providerEmail = IdentityNormalizer.normalizeEmail(providerEmail);
    this.providerEmailVerified = providerEmailVerified;
    validateState();
  }

  public static OAuthAccount linkGoogle(
      UUID userId, String googleSubject, String providerEmail, boolean providerEmailVerified) {
    return new OAuthAccount(
        userId,
        OAuthProvider.GOOGLE,
        googleSubject,
        providerEmail,
        providerEmailVerified);
  }

  @PrePersist
  @PreUpdate
  void validateState() {
    userId = Objects.requireNonNull(userId, "userId is required");
    provider = Objects.requireNonNull(provider, "provider is required");
    providerSubject = IdentityNormalizer.requireText(providerSubject, "providerSubject", 255);
    providerEmail = IdentityNormalizer.normalizeEmail(providerEmail);
    if (provider == OAuthProvider.GOOGLE && !providerEmailVerified) {
      throw new IllegalArgumentException("Google email claim must be verified");
    }
  }

  public UUID getId() {
    return id;
  }

  public UUID getUserId() {
    return userId;
  }

  public OAuthProvider getProvider() {
    return provider;
  }

  public String getProviderSubject() {
    return providerSubject;
  }

  public String getProviderEmail() {
    return providerEmail;
  }

  public boolean isProviderEmailVerified() {
    return providerEmailVerified;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
