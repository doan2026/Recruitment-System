package com.recruitment.auth.identity;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuthUserRepository extends JpaRepository<AuthUser, UUID> {
  Optional<AuthUser> findByNormalizedEmail(String normalizedEmail);

  boolean existsByNormalizedEmail(String normalizedEmail);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select authUser from AuthUser authUser where authUser.id = :userId")
  Optional<AuthUser> findByIdForUpdate(@Param("userId") UUID userId);
}
