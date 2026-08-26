package com.recruitment.auth.accountcontrol.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.auth.accountcontrol.AdminAccountControlService;
import com.recruitment.auth.api.ApiResponse;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;

class AdminAccountControlControllerTest {
  private static final UUID ACTOR_ID =
      UUID.fromString("11111111-2222-4333-8444-555555555555");
  private static final UUID TARGET_ID =
      UUID.fromString("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  private static final Instant NOW = Instant.parse("2026-08-27T08:15:30Z");

  @Test
  void delegatesWithSignedSubjectAndReturnsOnlySafeNoStoreState() throws Exception {
    AdminAccountControlService service =
        org.mockito.Mockito.mock(AdminAccountControlService.class);
    AdminAccountControlController controller =
        new AdminAccountControlController(service);
    AccountLockResponse safeResult =
        new AccountLockResponse(TARGET_ID, true, NOW, 4, 2);
    when(service.update(ACTOR_ID, TARGET_ID, true, "private evidence"))
        .thenReturn(safeResult);

    ResponseEntity<ApiResponse<AccountLockResponse>> response =
        controller.updateLock(
            adminJwt(),
            TARGET_ID,
            new UpdateAccountLockRequest(true, "private evidence"));

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getHeaders().getFirst(HttpHeaders.CACHE_CONTROL))
        .isEqualTo(CacheControl.noStore().getHeaderValue());
    assertThat(response.getHeaders().getFirst(HttpHeaders.PRAGMA))
        .isEqualTo("no-cache");
    assertThat(response.getBody()).isNotNull();
    assertThat(response.getBody().data()).isEqualTo(safeResult);
    assertThat(response.getBody().meta()).isEmpty();

    String serialized = new ObjectMapper()
        .findAndRegisterModules()
        .writeValueAsString(response.getBody());
    assertThat(serialized)
        .contains(TARGET_ID.toString(), "\"locked\":true")
        .doesNotContain("private evidence", "email", "reason");
    verify(service).update(ACTOR_ID, TARGET_ID, true, "private evidence");
  }

  private static Jwt adminJwt() {
    return Jwt.withTokenValue("signed-admin-access-token")
        .header("alg", "RS256")
        .subject(ACTOR_ID.toString())
        .claim("role", "ADMIN")
        .issuedAt(NOW.minusSeconds(60))
        .expiresAt(NOW.plusSeconds(600))
        .build();
  }
}
