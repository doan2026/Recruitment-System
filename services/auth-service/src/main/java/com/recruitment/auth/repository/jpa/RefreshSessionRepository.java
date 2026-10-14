package com.recruitment.auth.repository.jpa;

import com.recruitment.auth.model.RefreshSession;
import com.recruitment.auth.model.RefreshSessionRevocationReason;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RefreshSessionRepository extends JpaRepository<RefreshSession, UUID> {
  Optional<RefreshSession> findByTokenHash(String tokenHash);

  @Query("select session.userId from RefreshSession session where session.tokenHash = :tokenHash")
  Optional<UUID> findUserIdByTokenHash(@Param("tokenHash") String tokenHash);

  List<RefreshSession> findAllByFamilyIdOrderByIssuedAtAsc(UUID familyId);

  List<RefreshSession> findAllByUserIdOrderByIssuedAtAsc(UUID userId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select session from RefreshSession session where session.tokenHash = :tokenHash")
  Optional<RefreshSession> findByTokenHashForUpdate(@Param("tokenHash") String tokenHash);

  @Modifying(flushAutomatically = true)
  @Query("""
      update RefreshSession session
      set session.revokedAt = :at,
          session.revocationReason = :reason,
          session.version = session.version + 1
      where session.userId = :userId
        and session.revokedAt is null
        and session.expiresAt > :at
      """)
  int revokeActiveByUserId(
      @Param("userId") UUID userId,
      @Param("at") Instant at,
      @Param("reason") RefreshSessionRevocationReason reason);
}
