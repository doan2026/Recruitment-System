package com.recruitment.auth.service.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.recruitment.auth.dto.oauth.GoogleOAuthExchangeRequest;
import com.recruitment.auth.dto.oauth.GoogleOAuthRole;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.model.oauth.GoogleOAuthIdentity;
import com.recruitment.auth.repository.redis.oauth.GoogleOAuthExchangeStore;
import com.recruitment.auth.service.token.TokenSessionService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.redis.RedisConnectionFailureException;

@ExtendWith(MockitoExtension.class)
class GoogleOAuthExchangeServiceTest {
  private static final String CODE = "A".repeat(43);
  private static final String BINDER = "B".repeat(43);
  private static final UUID USER_ID =
      UUID.fromString("11111111-2222-4333-8444-555555555555");

  @Mock
  GoogleOAuthExchangeStore exchanges;

  @Mock
  GoogleOAuthAccountResolver accounts;

  @Mock
  TokenSessionService sessions;

  GoogleOAuthExchangeService service;

  @BeforeEach
  void setUp() {
    service = new GoogleOAuthExchangeService(exchanges, accounts, sessions);
  }

  @Test
  void consumesBinderBeforeResolvingAccountAndIssuingLocalTokens() {
    GoogleOAuthIdentity identity =
        new GoogleOAuthIdentity("google-subject", "candidate@example.com");
    AuthTokenResponse tokens = tokens();
    when(exchanges.consume(CODE, BINDER)).thenReturn(Optional.of(new GoogleOAuthExchangeStore.VerifiedExchange(identity, null)));
    when(accounts.resolveOrCreate(identity, GoogleOAuthRole.RECRUITER)).thenReturn(USER_ID);
    when(sessions.issueForVerifiedUser(USER_ID)).thenReturn(tokens);

    assertThat(service.exchange(
        new GoogleOAuthExchangeRequest(CODE, GoogleOAuthRole.RECRUITER), BINDER))
        .isSameAs(tokens);
    verify(sessions).issueForVerifiedUser(USER_ID);
  }

  @Test
  void mapsMissingOrConsumedCodeToOneGenericError() {
    when(exchanges.consume(CODE, BINDER)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.exchange(
            new GoogleOAuthExchangeRequest(CODE, null), BINDER))
        .isInstanceOfSatisfying(AuthBusinessException.class,
            error -> assertThat(error.code()).isEqualTo("GOOGLE_EXCHANGE_INVALID"));
  }

  @Test
  void mapsFirstLoginUniqueCollisionToStableRestartError() {
    GoogleOAuthIdentity identity =
        new GoogleOAuthIdentity("google-subject", "candidate@example.com");
    when(exchanges.consume(CODE, BINDER)).thenReturn(Optional.of(new GoogleOAuthExchangeStore.VerifiedExchange(identity, null)));
    when(accounts.resolveOrCreate(identity, null))
        .thenThrow(new DataIntegrityViolationException("unique constraint"));

    assertThatThrownBy(() -> service.exchange(
            new GoogleOAuthExchangeRequest(CODE, null), BINDER))
        .isInstanceOfSatisfying(AuthBusinessException.class,
            error -> assertThat(error.code()).isEqualTo("GOOGLE_LOGIN_RETRY"));
  }

  @Test
  void mapsRedisOutageWithoutLeakingInfrastructureDetails() {
    when(exchanges.consume(CODE, BINDER))
        .thenThrow(new RedisConnectionFailureException("redis host secret"));

    assertThatThrownBy(() -> service.exchange(
            new GoogleOAuthExchangeRequest(CODE, null), BINDER))
        .isInstanceOfSatisfying(AuthBusinessException.class, error -> {
          assertThat(error.code()).isEqualTo("GOOGLE_LOGIN_UNAVAILABLE");
          assertThat(error.getMessage()).doesNotContain("redis host secret");
        });
  }

  @Test
  void mapsAccountDatabaseOutageWithoutLeakingInfrastructureDetails() {
    GoogleOAuthIdentity identity =
        new GoogleOAuthIdentity("google-subject", "candidate@example.com");
    when(exchanges.consume(CODE, BINDER)).thenReturn(Optional.of(new GoogleOAuthExchangeStore.VerifiedExchange(identity, null)));
    when(accounts.resolveOrCreate(identity, null))
        .thenThrow(new DataAccessResourceFailureException("database host secret"));

    assertThatThrownBy(() -> service.exchange(
            new GoogleOAuthExchangeRequest(CODE, null), BINDER))
        .isInstanceOfSatisfying(AuthBusinessException.class, error -> {
          assertThat(error.code()).isEqualTo("GOOGLE_LOGIN_UNAVAILABLE");
          assertThat(error.getMessage()).doesNotContain("database host secret");
        });
  }

  @Test
  void boundPortalRoleIsUsedEvenWhenTheClientOmitsRole() {
    GoogleOAuthIdentity identity = new GoogleOAuthIdentity("google-subject", "recruiter@example.com");
    when(exchanges.consume(CODE, BINDER)).thenReturn(Optional.of(
        new GoogleOAuthExchangeStore.VerifiedExchange(identity, GoogleOAuthRole.RECRUITER)));
    when(accounts.resolveOrCreate(identity, GoogleOAuthRole.RECRUITER)).thenReturn(USER_ID);
    when(sessions.issueForVerifiedUser(USER_ID)).thenReturn(tokens());

    service.exchange(new GoogleOAuthExchangeRequest(CODE, null), BINDER);

    verify(accounts).resolveOrCreate(identity, GoogleOAuthRole.RECRUITER);
    verify(sessions).issueForVerifiedUser(USER_ID);
  }

  @Test
  void aClientCannotChangeThePortalBoundToTheExchangeCode() {
    when(exchanges.consume(CODE, BINDER)).thenReturn(Optional.of(
        new GoogleOAuthExchangeStore.VerifiedExchange(
            new GoogleOAuthIdentity("google-subject", "candidate@example.com"), GoogleOAuthRole.CANDIDATE)));

    assertThatThrownBy(() -> service.exchange(
        new GoogleOAuthExchangeRequest(CODE, GoogleOAuthRole.RECRUITER), BINDER))
        .isInstanceOfSatisfying(AuthBusinessException.class,
            error -> assertThat(error.code()).isEqualTo("GOOGLE_ROLE_MISMATCH"));
    verifyNoInteractions(accounts, sessions);
  }

  private static AuthTokenResponse tokens() {
    return new AuthTokenResponse(
        "local-access-token",
        "Bearer",
        900,
        "local-refresh-token",
        604800,
        new AuthTokenResponse.UserInfo(
            USER_ID, "candidate@example.com", UserRole.CANDIDATE));
  }
}
