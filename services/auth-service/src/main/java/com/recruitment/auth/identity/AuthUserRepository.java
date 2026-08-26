package com.recruitment.auth.identity;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuthUserRepository extends JpaRepository<AuthUser, UUID> {
  Optional<AuthUser> findByNormalizedEmail(String normalizedEmail);

  boolean existsByNormalizedEmail(String normalizedEmail);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select authUser from AuthUser authUser where authUser.id = :userId")
  Optional<AuthUser> findByIdForUpdate(@Param("userId") UUID userId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("""
      select authUser
      from AuthUser authUser
      where authUser.normalizedEmail = :normalizedEmail
      """)
  Optional<AuthUser> findByNormalizedEmailForUpdate(
      @Param("normalizedEmail") String normalizedEmail);

  @Query(value = "SELECT nextval('auth.registration_flow_fence_seq')", nativeQuery = true)
  long nextRegistrationFence();

  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(value = """
      INSERT INTO auth.users AS existing
        (id, email, normalized_email, password_hash, role,
         registration_id, registration_fence,
         is_verified, is_locked, version, created_at, updated_at)
      VALUES
        (:id, :email, :normalizedEmail, :passwordHash, :role,
         :registrationId, :registrationFence,
         FALSE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (normalized_email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          registration_id = EXCLUDED.registration_id,
          registration_fence = EXCLUDED.registration_fence,
          version = existing.version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE existing.is_verified = FALSE
        AND existing.registration_fence < EXCLUDED.registration_fence
      """, nativeQuery = true)
  int upsertPendingRegistration(
      @Param("id") UUID id,
      @Param("email") String email,
      @Param("normalizedEmail") String normalizedEmail,
      @Param("passwordHash") String passwordHash,
      @Param("role") String role,
      @Param("registrationId") UUID registrationId,
      @Param("registrationFence") long registrationFence);
}
