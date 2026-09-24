package com.recruitment.auth.accountcontrol.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.recruitment.auth.account.CurrentAccountService;
import com.recruitment.auth.account.api.CurrentAccountResponse;
import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.UserRole;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;

class AdminUserDirectoryControllerTest {

  final JdbcTemplate db = mock(JdbcTemplate.class);
  final CurrentAccountService current = mock(CurrentAccountService.class);
  final AdminUserDirectoryController controller =
    new AdminUserDirectoryController(db, current);
  final UUID id = UUID.randomUUID();
  final Jwt jwt = Jwt.withTokenValue("test")
    .header("alg", "RS256")
    .subject(id.toString())
    .build();

  @Test
  void demotedAdminCannotReadDirectoryEvenWithOldToken() {
    when(current.get(id)).thenReturn(
      new CurrentAccountResponse(
        id,
        "user@example.com",
        UserRole.CANDIDATE,
        true
      )
    );
    assertThrows(AuthBusinessException.class, () ->
      controller.list(jwt, "", null, null, 1, 20)
    );
    verifyNoInteractions(db);
  }

  @Test
  void rejectsUnboundedPagination() {
    when(current.get(id)).thenReturn(
      new CurrentAccountResponse(id, "admin@example.com", UserRole.ADMIN, true)
    );
    assertThrows(AuthBusinessException.class, () ->
      controller.list(jwt, "", null, null, 1, 1000)
    );
    verifyNoInteractions(db);
  }

  @Test
  void literalWildcardsDoNotBecomeSearchPatterns() {
    when(current.get(id)).thenReturn(
      new CurrentAccountResponse(id, "admin@example.com", UserRole.ADMIN, true)
    );
    when(
      db.queryForObject(anyString(), eq(Long.class), any(Object[].class))
    ).thenReturn(0L);
    when(db.queryForList(anyString(), any(Object[].class))).thenReturn(
      List.of()
    );
    controller.list(jwt, "a%b_c!", null, null, 1, 20);
    verify(db).queryForList(
      contains("normalized_email LIKE ? ESCAPE '!'"),
      eq("%a!%b!_c!!%"),
      eq(20),
      eq(0)
    );
  }
}
