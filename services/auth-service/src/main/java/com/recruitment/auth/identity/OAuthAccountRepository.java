package com.recruitment.auth.identity;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OAuthAccountRepository extends JpaRepository<OAuthAccount, UUID> {
  Optional<OAuthAccount> findByProviderAndProviderSubject(
      OAuthProvider provider, String providerSubject);

  Optional<OAuthAccount> findByUserIdAndProvider(UUID userId, OAuthProvider provider);
}
