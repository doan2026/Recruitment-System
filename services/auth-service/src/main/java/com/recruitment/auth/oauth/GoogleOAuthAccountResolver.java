package com.recruitment.auth.oauth;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.OAuthAccount;
import com.recruitment.auth.identity.OAuthAccountRepository;
import com.recruitment.auth.identity.OAuthProvider;
import com.recruitment.auth.identity.UserRole;
import java.time.Clock;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class GoogleOAuthAccountResolver {
  private final AuthUserRepository users;
  private final OAuthAccountRepository accounts;
  private final Clock clock;

  GoogleOAuthAccountResolver(
      AuthUserRepository users,
      OAuthAccountRepository accounts,
      Clock clock) {
    this.users = Objects.requireNonNull(users, "users are required");
    this.accounts = Objects.requireNonNull(accounts, "accounts are required");
    this.clock = Objects.requireNonNull(clock, "clock is required");
  }

  @Transactional
  public UUID resolveOrCreate(GoogleOAuthIdentity identity, GoogleOAuthRole requestedRole) {
    GoogleOAuthIdentity safeIdentity = Objects.requireNonNull(identity, "identity is required");
    return accounts.findByProviderAndProviderSubjectForUpdate(
            OAuthProvider.GOOGLE, safeIdentity.subject())
        .map(account -> requireLinkedUser(account.getUserId()))
        .orElseGet(() -> createOAuthOnlyUser(safeIdentity, requestedRole));
  }

  private UUID requireLinkedUser(UUID userId) {
    return users.findByIdForUpdate(userId)
        .orElseThrow(() -> new IllegalStateException("linked Google user no longer exists"))
        .getId();
  }

  private UUID createOAuthOnlyUser(
      GoogleOAuthIdentity identity,
      GoogleOAuthRole requestedRole) {
    if (users.findByNormalizedEmailForUpdate(identity.normalizedEmail()).isPresent()) {
      throw new AuthBusinessException(
          "ACCOUNT_LINK_REQUIRED",
          "An account already exists for this email; sign in before linking Google",
          HttpStatus.CONFLICT);
    }
    UserRole role = requestedRole == null
        ? UserRole.CANDIDATE
        : requestedRole.toUserRole();
    AuthUser user = users.saveAndFlush(
        AuthUser.registerOAuth(identity.normalizedEmail(), role, clock.instant()));
    accounts.saveAndFlush(OAuthAccount.linkGoogle(
        user.getId(), identity.subject(), identity.normalizedEmail(), true));
    return user.getId();
  }
}
