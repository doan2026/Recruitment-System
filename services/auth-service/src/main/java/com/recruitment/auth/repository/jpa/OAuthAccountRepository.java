package com.recruitment.auth.repository.jpa;

import com.recruitment.auth.model.OAuthAccount;
import com.recruitment.auth.model.OAuthProvider;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OAuthAccountRepository extends JpaRepository<OAuthAccount, UUID> {
  Optional<OAuthAccount> findByProviderAndProviderSubject(
      OAuthProvider provider, String providerSubject);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("""
      select account
      from OAuthAccount account
      where account.provider = :provider
        and account.providerSubject = :providerSubject
      """)
  Optional<OAuthAccount> findByProviderAndProviderSubjectForUpdate(
      @Param("provider") OAuthProvider provider,
      @Param("providerSubject") String providerSubject);

  Optional<OAuthAccount> findByUserIdAndProvider(UUID userId, OAuthProvider provider);
}
