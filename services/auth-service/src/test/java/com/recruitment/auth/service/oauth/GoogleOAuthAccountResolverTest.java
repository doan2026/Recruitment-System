package com.recruitment.auth.service.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;
import com.recruitment.auth.dto.oauth.GoogleOAuthRole;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.OAuthAccount;
import com.recruitment.auth.model.OAuthProvider;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.model.oauth.GoogleOAuthIdentity;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import com.recruitment.auth.repository.jpa.OAuthAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class GoogleOAuthAccountResolverTest {
  private static final Instant NOW = Instant.parse("2026-08-26T10:00:00Z");

  @Mock
  AuthUserRepository users;

  @Mock
  OAuthAccountRepository accounts;

  GoogleOAuthAccountResolver resolver;

  @BeforeEach
  void setUp() {
    resolver = new GoogleOAuthAccountResolver(
        users, accounts, Clock.fixed(NOW, ZoneOffset.UTC));
  }

  @Test
  void existingProviderSubjectIsAuthoritativeEvenWhenProviderEmailChanges() {
    AuthUser linkedUser = AuthUser.registerOAuth("old@example.com", NOW);
    OAuthAccount account = OAuthAccount.linkGoogle(
        linkedUser.getId(), "google-subject", "old@example.com", true);
    when(accounts.findByProviderAndProviderSubjectForUpdate(
        OAuthProvider.GOOGLE, "google-subject")).thenReturn(Optional.of(account));
    when(users.findByIdForUpdate(linkedUser.getId())).thenReturn(Optional.of(linkedUser));

    assertThat(resolver.resolveOrCreate(
        new GoogleOAuthIdentity("google-subject", "new@example.com"),
        GoogleOAuthRole.CANDIDATE)).isEqualTo(linkedUser.getId());
  }

  @Test
  void linkedAccountCannotSwitchRoleByEnteringAnotherPortal() {
    AuthUser candidate = AuthUser.registerOAuth("existing@example.com", NOW);
    when(accounts.findByProviderAndProviderSubjectForUpdate(OAuthProvider.GOOGLE, "google-subject"))
        .thenReturn(Optional.of(OAuthAccount.linkGoogle(candidate.getId(), "google-subject", "existing@example.com", true)));
    when(users.findByIdForUpdate(candidate.getId())).thenReturn(Optional.of(candidate));

    assertThatThrownBy(() -> resolver.resolveOrCreate(
        new GoogleOAuthIdentity("google-subject", "existing@example.com"), GoogleOAuthRole.RECRUITER))
        .isInstanceOfSatisfying(AuthBusinessException.class,
            error -> assertThat(error.code()).isEqualTo("GOOGLE_ROLE_MISMATCH"));
    assertThat(candidate.getRole()).isEqualTo(UserRole.CANDIDATE);
    verify(users, never()).saveAndFlush(any());
  }

  @Test
  void existingUnlinkedEmailAlwaysRequiresExplicitAccountLinking() {
    AuthUser local = AuthUser.registerLocal(
        "existing@example.com",
        "$2a$10$7EqJtq98hPqEX7fNZaFWoO5uIyQ9BGEWJvK3KEGzA5jU6ZiD5.QY.",
        UserRole.CANDIDATE);
    when(accounts.findByProviderAndProviderSubjectForUpdate(
        OAuthProvider.GOOGLE, "new-subject")).thenReturn(Optional.empty());
    when(users.findByNormalizedEmailForUpdate("existing@example.com"))
        .thenReturn(Optional.of(local));

    assertThatThrownBy(() -> resolver.resolveOrCreate(
            new GoogleOAuthIdentity("new-subject", "existing@example.com"),
            null))
        .isInstanceOfSatisfying(AuthBusinessException.class,
            error -> assertThat(error.code()).isEqualTo("ACCOUNT_LINK_REQUIRED"));
  }

  @Test
  void createsVerifiedOAuthOnlyRecruiterAndLinksSubject() {
    when(accounts.findByProviderAndProviderSubjectForUpdate(
        OAuthProvider.GOOGLE, "new-subject")).thenReturn(Optional.empty());
    when(users.findByNormalizedEmailForUpdate("new@example.com"))
        .thenReturn(Optional.empty());
    when(users.saveAndFlush(any(AuthUser.class))).thenAnswer(invocation -> invocation.getArgument(0));
    when(accounts.saveAndFlush(any(OAuthAccount.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));

    resolver.resolveOrCreate(
        new GoogleOAuthIdentity("new-subject", "NEW@example.com"),
        GoogleOAuthRole.RECRUITER);

    ArgumentCaptor<AuthUser> userCaptor = ArgumentCaptor.forClass(AuthUser.class);
    verify(users).saveAndFlush(userCaptor.capture());
    AuthUser created = userCaptor.getValue();
    assertThat(created.isVerified()).isTrue();
    assertThat(created.getVerifiedAt()).isEqualTo(NOW);
    assertThat(created.getPasswordHash()).isNull();
    assertThat(created.getRole()).isEqualTo(UserRole.RECRUITER);

    ArgumentCaptor<OAuthAccount> accountCaptor = ArgumentCaptor.forClass(OAuthAccount.class);
    verify(accounts).saveAndFlush(accountCaptor.capture());
    assertThat(accountCaptor.getValue().getUserId()).isEqualTo(created.getId());
    assertThat(accountCaptor.getValue().getProviderSubject()).isEqualTo("new-subject");
  }
}
