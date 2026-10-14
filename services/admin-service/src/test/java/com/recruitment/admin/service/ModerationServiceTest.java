package com.recruitment.admin.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.repository.ModerationRepository;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.security.oauth2.jwt.Jwt;

class ModerationServiceTest {

  final ServiceGateway gateway = mock(ServiceGateway.class);
  final ModerationRepository store = mock(ModerationRepository.class);
  final ModerationService service = new ModerationService(gateway, store);
  final UUID actor = UUID.randomUUID(), target = UUID.randomUUID();
  final Jwt jwt = Jwt.withTokenValue("test")
    .header("alg", "RS256")
    .subject(actor.toString())
    .build();

  @Test
  void persistsIntentBeforeRemoteCallAndSuccessAfterward() throws Exception {
    var response = new ObjectMapper().readTree("{\"data\":{}}");
    when(
      gateway.call(anyString(), any(), anyString(), any(), any())
    ).thenReturn(response);
    service.mutate(
      jwt,
      "JOB",
      target,
      "APPROVE_JOB",
      "/" + target + "/approve",
      Map.of(),
      null
    );
    var order = inOrder(gateway, store);
    order.verify(gateway).requireCurrentAdmin(jwt);
    order
      .verify(store)
      .audit(
        any(),
        eq(actor),
        eq("APPROVE_JOB"),
        eq("JOB"),
        eq(target),
        isNull(),
        eq("STARTED")
      );
    order
      .verify(gateway)
      .call(eq("JOB"), eq(HttpMethod.PATCH), anyString(), any(), eq(jwt));
    order
      .verify(store)
      .audit(
        any(),
        eq(actor),
        eq("APPROVE_JOB"),
        eq("JOB"),
        eq(target),
        isNull(),
        eq("SUCCEEDED")
      );
  }

  @Test
  void timeoutLeavesUnknownAuditInsteadOfClaimingFailureOrSuccess() {
    when(gateway.call(anyString(), any(), anyString(), any(), any())).thenThrow(
      new AdminFailure(503, "UPSTREAM_UNAVAILABLE")
    );
    assertThrows(AdminFailure.class, () ->
      service.mutate(
        jwt,
        "AUTH",
        target,
        "LOCK_USER",
        "/auth/users/" + target + "/lock",
        Map.of("locked", true),
        "Spam"
      )
    );
    verify(store).audit(
      any(),
      eq(actor),
      eq("LOCK_USER"),
      eq("AUTH"),
      eq(target),
      eq("Spam"),
      eq("UNKNOWN")
    );
    verify(store, never()).audit(
      any(),
      any(),
      any(),
      any(),
      any(),
      any(),
      eq("SUCCEEDED")
    );
  }

  @Test
  void lockedOrDemotedAdminCannotStartMutation() {
    doThrow(new AdminFailure(403, "ACCESS_DENIED"))
      .when(gateway)
      .requireCurrentAdmin(jwt);
    assertThrows(AdminFailure.class, () ->
      service.mutate(
        jwt,
        "JOB",
        target,
        "APPROVE_JOB",
        "/" + target + "/approve",
        Map.of(),
        null
      )
    );
    verifyNoInteractions(store);
  }
}
