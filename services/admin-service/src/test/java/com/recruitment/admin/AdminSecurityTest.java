package com.recruitment.admin;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

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
  controllers = AdminController.class,
  properties = { "admin.cors-origins=http://localhost:3000" }
)
@Import(AdminSecurity.class)
class AdminSecurityTest {

  @Autowired
  MockMvc mvc;

  @MockBean
  JwtDecoder decoder;

  @MockBean
  ServiceGateway gateway;

  @MockBean
  ModerationStore store;

  @MockBean
  ModerationService moderation;

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
    verifyNoInteractions(moderation, store, gateway);
  }

  @Test
  void reportSubmissionIsAuthenticatedExceptionToAdminOnly() throws Exception {
    UUID actor = UUID.randomUUID(), target = UUID.randomUUID();
    when(store.createReport(any(), any(), any(), any(), any())).thenReturn(
      Map.of("id", UUID.randomUUID(), "status", "OPEN")
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
    verifyNoInteractions(moderation);
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
