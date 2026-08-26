package com.recruitment.auth.identity;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
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
}
