package com.recruitment.auth.controller;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.recruitment.auth.dto.registration.RegistrationResponse;
import com.recruitment.auth.dto.token.AuthTokenResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.service.registration.RegistrationService;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(RegistrationController.class)
@AutoConfigureMockMvc(addFilters = false)
class RegistrationControllerTest {
  private static final UUID REGISTRATION_ID =
      UUID.fromString("11111111-2222-4333-8444-555555555555");

  @Autowired
  MockMvc mvc;

  @MockBean
  RegistrationService registration;

  @Test
  void registerReturnsFlowIdentityWithoutEchoingPassword() throws Exception {
    when(registration.register(any())).thenReturn(
        new RegistrationResponse("OTP_REQUIRED", 300, REGISTRATION_ID));

    mvc.perform(post("/auth/register")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "email": "Candidate@Example.com",
                  "password": "candidate1",
                  "role": "CANDIDATE"
                }
                """))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.data.status").value("OTP_REQUIRED"))
        .andExpect(jsonPath("$.data.expiresInSeconds").value(300))
        .andExpect(jsonPath("$.data.registrationId").value(REGISTRATION_ID.toString()))
        .andExpect(jsonPath("$.meta").isMap())
        .andExpect(content().string(not(containsString("candidate1"))));
  }

  @Test
  void verifyRequiresFlowIdentityAndReturnsCanonicalAccountWithoutOtp() throws Exception {
    UUID userId = UUID.randomUUID();
    when(registration.verify(any())).thenReturn(new AuthTokenResponse(
        "access-token", "Bearer", 900, "refresh-token", 604800,
        new AuthTokenResponse.UserInfo(userId, "candidate@example.com", UserRole.CANDIDATE)));

    mvc.perform(post("/auth/otp/verify")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "email":"candidate@example.com",
                  "registrationId":"%s",
                  "otp":"001234"
                }
                """.formatted(REGISTRATION_ID)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store, no-cache"))
        .andExpect(header().string("Pragma", "no-cache"))
        .andExpect(header().string("Expires", "0"))
        .andExpect(jsonPath("$.data.accessToken").value("access-token"))
        .andExpect(jsonPath("$.data.refreshToken").value("refresh-token"))
        .andExpect(jsonPath("$.data.user.id").value(userId.toString()))
        .andExpect(jsonPath("$.data.user.role").value("CANDIDATE"))
        .andExpect(content().string(not(containsString("001234"))));
  }

  @Test
  void rejectsInvalidOtpShapeWithStandardErrorEnvelope() throws Exception {
    mvc.perform(post("/auth/otp/verify")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "email":"candidate@example.com",
                  "registrationId":"%s",
                  "otp":"1234"
                }
                """.formatted(REGISTRATION_ID)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.otp").exists());
  }

  @Test
  void rejectsMissingRegistrationIdForVerifyAndResend() throws Exception {
    mvc.perform(post("/auth/otp/verify")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"candidate@example.com","otp":"001234"}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.registrationId").exists());

    mvc.perform(post("/auth/otp/resend")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"candidate@example.com"}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.registrationId").exists());
  }

  @Test
  void rejectsAdminAndMissingPasswordBeforeCallingService() throws Exception {
    mvc.perform(post("/auth/register")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"admin@example.com","role":"ADMIN"}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
  }

  @Test
  void rateLimitIncludesRetryAfterHeaderAndSafeDetails() throws Exception {
    when(registration.resend(any())).thenThrow(new AuthBusinessException(
        "OTP_RESEND_LIMITED",
        "Too many verification-code resend requests",
        HttpStatus.TOO_MANY_REQUESTS,
        Map.of("retryAfterSeconds", 42),
        42L));

    mvc.perform(post("/auth/otp/resend")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"candidate@example.com","registrationId":"%s"}
                """.formatted(REGISTRATION_ID)))
        .andExpect(status().isTooManyRequests())
        .andExpect(header().string("Retry-After", "42"))
        .andExpect(jsonPath("$.code").value("OTP_RESEND_LIMITED"))
        .andExpect(jsonPath("$.details.retryAfterSeconds").value(42));
  }
}
