package com.recruitment.auth.controller;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.recruitment.auth.dto.passwordreset.ForgotPasswordRequest;
import com.recruitment.auth.dto.passwordreset.ForgotPasswordResponse;
import com.recruitment.auth.dto.passwordreset.ResetPasswordRequest;
import com.recruitment.auth.service.passwordreset.PasswordResetService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(PasswordResetController.class)
@AutoConfigureMockMvc(addFilters = false)
class PasswordResetControllerTest {
  private static final String EMAIL = "candidate@example.com";
  private static final String RESET_TOKEN = "pr1_reset-token-that-must-not-leak";
  private static final String NEW_PASSWORD = "New-password1";

  @Autowired
  MockMvc mvc;

  @MockBean
  PasswordResetService passwordReset;

  @Test
  void forgotReturnsGenericAcceptedEnvelopeWithoutCachingOrEchoingIdentity() throws Exception {
    when(passwordReset.forgot(any())).thenReturn(
        new ForgotPasswordResponse("RESET_EMAIL_SENT_IF_ELIGIBLE", 900));

    mvc.perform(post("/auth/forgot-password")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"%s"}
                """.formatted(EMAIL)))
        .andExpect(status().isAccepted())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store, no-cache"))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(header().string(HttpHeaders.EXPIRES, "0"))
        .andExpect(jsonPath("$.data.status").value("RESET_EMAIL_SENT_IF_ELIGIBLE"))
        .andExpect(jsonPath("$.data.expiresInSeconds").value(900))
        .andExpect(jsonPath("$.meta").isMap())
        .andExpect(content().string(not(containsString(EMAIL))))
        .andExpect(content().string(not(containsString("token"))));

    verify(passwordReset).forgot(new ForgotPasswordRequest(EMAIL));
  }

  @Test
  void resetReturnsNoContentWithoutCachingOrEchoingCredentials() throws Exception {
    mvc.perform(post("/auth/reset-password")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"token":"%s","newPassword":"%s"}
                """.formatted(RESET_TOKEN, NEW_PASSWORD)))
        .andExpect(status().isNoContent())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store, no-cache"))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(header().string(HttpHeaders.EXPIRES, "0"))
        .andExpect(content().string(""))
        .andExpect(content().string(not(containsString(RESET_TOKEN))))
        .andExpect(content().string(not(containsString(NEW_PASSWORD))));

    verify(passwordReset).reset(new ResetPasswordRequest(RESET_TOKEN, NEW_PASSWORD));
  }

  @Test
  void forgotRejectsInvalidEmailBeforeCallingService() throws Exception {
    String invalidEmail = "not-an-email";

    mvc.perform(post("/auth/forgot-password")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"%s"}
                """.formatted(invalidEmail)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.email").exists())
        .andExpect(content().string(not(containsString(invalidEmail))));

    verify(passwordReset, never()).forgot(any());
  }

  @Test
  void resetRejectsBlankTokenAndPasswordBeforeCallingService() throws Exception {
    mvc.perform(post("/auth/reset-password")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"token":" ","newPassword":""}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.token").exists())
        .andExpect(jsonPath("$.details.newPassword").exists());

    verify(passwordReset, never()).reset(any());
  }
}
