package com.recruitment.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.recruitment.auth.dto.accountcontrol.AdminUserResponse;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.service.accountcontrol.AdminUserDirectoryService;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.oauth2.jwt.Jwt;

class AdminUserDirectoryControllerTest {
  @Test
  void preservesDirectoryEnvelopeAndPagination() {
    UUID actingId = UUID.randomUUID();
    UUID userId = UUID.randomUUID();
    var service = mock(AdminUserDirectoryService.class);
    var user = new AdminUserResponse(userId, "candidate@example.com", UserRole.CANDIDATE,
        true, false, null, Timestamp.from(Instant.parse("2026-10-14T00:00:00Z")));
    when(service.list(actingId, "candidate", UserRole.CANDIDATE, false, 2, 20))
        .thenReturn(new PageImpl<>(List.of(user), PageRequest.of(1, 20), 21));
    Jwt jwt = Jwt.withTokenValue("test").header("alg", "RS256").subject(actingId.toString()).build();

    var response = new AdminUserDirectoryController(service)
        .list(jwt, "candidate", UserRole.CANDIDATE, false, 2, 20);

    assertThat(response.data()).containsExactly(user);
    assertThat(response.meta()).containsEntry("page", 2).containsEntry("limit", 20)
        .containsEntry("total", 21L);
  }

  @Test
  void directoryDtoKeepsExistingJsonNamesAndDoesNotExposePasswords() throws Exception {
    var user = new AdminUserResponse(UUID.randomUUID(), "candidate@example.com", UserRole.CANDIDATE,
        true, false, null, Timestamp.from(Instant.parse("2026-10-14T00:00:00Z")));
    var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
    var json = mapper.readTree(mapper.writeValueAsString(user));

    assertThat(json.properties()).extracting(java.util.Map.Entry::getKey).containsExactlyInAnyOrder(
        "id", "email", "role", "is_verified", "is_locked", "locked_reason", "created_at");
    assertThat(json.get("is_verified").asBoolean()).isTrue();
    assertThat(json.get("is_locked").asBoolean()).isFalse();
  }
}
