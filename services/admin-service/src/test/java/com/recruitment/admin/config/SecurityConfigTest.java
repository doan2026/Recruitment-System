package com.recruitment.admin.config;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.recruitment.admin.controller.ModerationController;
import com.recruitment.admin.controller.ReportController;
import com.recruitment.admin.controller.AuditController;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.repository.ModerationRepository;
import com.recruitment.admin.service.ModerationService;
import com.recruitment.admin.service.ReportService;
import com.recruitment.admin.service.AuditService;
import com.recruitment.admin.service.AdminQueryService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(
  controllers = {ModerationController.class, ReportController.class, AuditController.class},
  properties = { "admin.cors-origins=http://localhost:3000" }
)
@Import({SecurityConfig.class, ModerationService.class, ReportService.class, AuditService.class, AdminQueryService.class})
class SecurityConfigTest {

  @Autowired
  MockMvc mvc;

  @MockBean
  JwtDecoder decoder;

  @MockBean
  ServiceGateway gateway;

  @MockBean
  ModerationRepository store;

  @Test
  void anonymousCannotReadModeration() throws Exception {
    mvc
      .perform(get("/users"))
      .andExpect(status().isUnauthorized())
      .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    verifyNoInteractions(gateway);
  }

  @Test
  void candidateCannotReadOrMutateAdminResources() throws Exception {
    var candidate = jwt()
      .authorities(new SimpleGrantedAuthority("ROLE_CANDIDATE"));
    mvc
      .perform(get("/reports").with(candidate))
      .andExpect(status().isForbidden());
    mvc
      .perform(
        patch("/users/" + UUID.randomUUID() + "/lock")
          .with(candidate)
          .contentType("application/json")
          .content("{\"locked\":true,\"reason\":\"Violation\"}")
      )
      .andExpect(status().isForbidden());
    verifyNoInteractions(store, gateway);
  }

  @Test
  void reportSubmissionIsAuthenticatedExceptionToAdminOnly() throws Exception {
    UUID actor = UUID.randomUUID(), target = UUID.randomUUID();
    when(store.createReport(any(), any(), any(), any(), any())).thenReturn(
      UUID.randomUUID()
    );
    mvc
      .perform(
        post("/reports")
          .with(
            jwt()
              .jwt(j -> j.subject(actor.toString()))
              .authorities(new SimpleGrantedAuthority("ROLE_CANDIDATE"))
          )
          .contentType("application/json")
          .content(
            "{\"targetType\":\"JOB\",\"targetId\":\"" +
            target +
            "\",\"reason\":\"Spam advertisement\"}"
          )
      )
      .andExpect(status().isCreated())
      .andExpect(jsonPath("$.data.status").value("OPEN"));
    verify(store).createReport(
      eq(actor),
      eq("JOB"),
      eq(target),
      eq("Spam advertisement"),
      isNull()
    );
  }

  @Test
  void rejectRequiresReasonBeforeUpstreamCall() throws Exception {
    mvc
      .perform(
        patch("/companies/" + UUID.randomUUID() + "/verify")
          .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_ADMIN")))
          .contentType("application/json")
          .content("{\"decision\":\"REJECT\"}")
      )
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.code").value("REASON_REQUIRED"));
    verifyNoInteractions(store, gateway);
  }

  @Test
  void reportCannotChooseReporterOrUnknownFields() throws Exception {
    mvc
      .perform(
        post("/reports")
          .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_CANDIDATE")))
          .contentType("application/json")
          .content(
            "{\"targetType\":\"JOB\",\"targetId\":\"" +
            UUID.randomUUID() +
            "\",\"reason\":\"Spam\",\"reporterId\":\"forged\"}"
          )
      )
      .andExpect(status().isBadRequest());
    verifyNoInteractions(store);
  }
}
