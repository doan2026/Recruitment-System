package com.recruitment.admin.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.admin.dto.moderation.CreateReportRequest;
import com.recruitment.admin.dto.moderation.ResolveReportRequest;
import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.model.Report;
import com.recruitment.admin.repository.ModerationRepository;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.security.oauth2.jwt.Jwt;

class ReportServiceTest {
  private final ServiceGateway gateway = mock(ServiceGateway.class);
  private final ModerationRepository repository = mock(ModerationRepository.class);
  private final ReportService service = new ReportService(gateway, repository);
  private final UUID actor = UUID.randomUUID();
  private final UUID reportId = UUID.randomUUID();
  private final UUID target = UUID.randomUUID();
  private final Jwt jwt = Jwt.withTokenValue("test").header("alg", "RS256").subject(actor.toString()).build();

  @Test
  void candidateReportUsesAuthenticatedReporterAndNormalizedReason() {
    when(repository.createReport(any(), anyString(), any(), anyString(), any())).thenReturn(reportId);
    var result = service.create(jwt, new CreateReportRequest("USER", target, "  Spam report  ", null));

    verify(repository).createReport(actor, "USER", target, "Spam report", null);
    assertEquals(reportId, result.data().id());
    assertEquals("OPEN", result.data().status());
    assertEquals(0, result.data().version());
    verifyNoInteractions(gateway);
  }

  @Test
  void resolvingUserReportLocksExactTargetAfterStartedAudit() {
    stubReport("USER");
    var result = service.resolve(jwt, reportId, new ResolveReportRequest("RESOLVED", "Confirmed spam", 0));

    var order = inOrder(gateway, repository);
    order.verify(gateway).requireCurrentAdmin(jwt);
    order.verify(repository).claim(eq(reportId), eq(0), eq(actor), eq("Confirmed spam"), any());
    order.verify(repository).audit(any(), eq(actor), eq("HANDLE_REPORT"), eq("REPORT"), eq(reportId), eq("Confirmed spam"), eq("STARTED"));
    order.verify(gateway).call(eq("AUTH"), eq(HttpMethod.PATCH), eq("/auth/users/" + target + "/lock"),
        eq(Map.of("locked", true, "reason", "Confirmed spam")), eq(jwt));
    order.verify(repository).finish(eq(reportId), any(), eq("RESOLVED"));
    order.verify(repository).audit(any(), eq(actor), eq("HANDLE_REPORT"), eq("REPORT"), eq(reportId), eq("Confirmed spam"), eq("SUCCEEDED"));
    assertEquals("RESOLVED", result.data().status());
  }

  @Test
  void timeoutKeepsProcessingAndAppendsUnknownOutcome() {
    stubReport("USER");
    when(gateway.call(anyString(), any(), anyString(), any(), any())).thenThrow(new AdminFailure(503, "UPSTREAM_UNAVAILABLE"));

    assertThrows(AdminFailure.class, () -> service.resolve(jwt, reportId, new ResolveReportRequest("RESOLVED", "Confirmed spam", 0)));

    verify(repository, never()).finish(any(), any(), anyString());
    verify(repository).audit(any(), eq(actor), eq("HANDLE_REPORT"), eq("REPORT"), eq(reportId), eq("Confirmed spam"), eq("UNKNOWN"));
  }

  @Test
  void unsupportedTakedownReopensReportWithFailedAudit() {
    stubReport("COMPANY");
    var error = assertThrows(AdminFailure.class,
        () -> service.resolve(jwt, reportId, new ResolveReportRequest("RESOLVED", "Confirmed spam", 0)));

    assertEquals("TAKEDOWN_CONTRACT_UNAVAILABLE", error.code());
    verify(repository).finish(eq(reportId), any(), eq("OPEN"));
    verify(repository).audit(any(), eq(actor), eq("HANDLE_REPORT"), eq("REPORT"), eq(reportId), eq("Confirmed spam"), eq("FAILED"));
    verify(gateway, never()).call(anyString(), any(), anyString(), any(), any());
  }

  @Test
  void dismissDoesNotMutateOwningService() {
    stubReport("JOB");
    service.resolve(jwt, reportId, new ResolveReportRequest("DISMISSED", "No violation found", 0));

    verify(repository).finish(eq(reportId), any(), eq("DISMISSED"));
    verify(gateway, never()).call(anyString(), any(), anyString(), any(), any());
  }

  @Test
  void lockedOrDemotedAdminCannotClaimReport() {
    doThrow(new AdminFailure(403, "ACCESS_DENIED")).when(gateway).requireCurrentAdmin(jwt);

    assertThrows(AdminFailure.class, () -> service.resolve(jwt, reportId, new ResolveReportRequest("RESOLVED", "Confirmed spam", 0)));
    verifyNoInteractions(repository);
  }

  private void stubReport(String type) {
    when(repository.claim(eq(reportId), eq(0), eq(actor), anyString(), any())).thenReturn(new Report(
        reportId, UUID.randomUUID(), type, target, "Spam report", null, "OPEN", 0,
        null, null, null, null, Instant.parse("2026-10-14T00:00:00Z")));
  }
}
