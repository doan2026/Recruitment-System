package com.recruitment.interview.scheduling;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.domain.InterviewStatus;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ImportSelector;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(
    controllers = InterviewSchedulingController.class,
    properties = {
        "CORS_ORIGINS=http://localhost:3000",
        "JWT_PUBLIC_KEY_PATH=/tmp/interview-controller-test-public.pem"
    }
)
@Import(InterviewSchedulingControllerTest.InterviewSecurityImport.class)
class InterviewSchedulingControllerTest {
  private static final UUID RECRUITER_ID = UUID.fromString(
      "223e4567-e89b-42d3-a456-426614174000");
  private static final UUID APPLICATION_ID = UUID.fromString(
      "323e4567-e89b-42d3-a456-426614174000");
  private static final UUID REQUEST_ID = UUID.fromString(
      "423e4567-e89b-42d3-a456-426614174000");
  private static final UUID INTERVIEW_ID = UUID.fromString(
      "523e4567-e89b-42d3-a456-426614174000");

  @Autowired
  private MockMvc mvc;

  @MockBean
  private InterviewSchedulingService scheduling;

  @MockBean
  private JwtDecoder jwtDecoder;

  @Test
  void preservesSubmittedOffsetBeforeSchedulingValidation() throws Exception {
    when(scheduling.schedule(eq(RECRUITER_ID), eq("signed-access-token"), any()))
        .thenReturn(new ScheduleInterviewResult(response(), false));
    mvc.perform(post("/interviews").with(recruiter())
            .contentType(MediaType.APPLICATION_JSON).content(validBody()))
        .andExpect(status().isCreated());
    verify(scheduling).schedule(eq(RECRUITER_ID), eq("signed-access-token"),
        argThat(request -> request.scheduledStart().getOffset().getTotalSeconds() == 7 * 3600
            && request.scheduledStart().getHour() == 9));
  }

  @Test
  void recruiterSchedulesInterviewAndReceivesNoStoreCreatedResponse()
      throws Exception {
    when(scheduling.schedule(eq(RECRUITER_ID), eq("signed-access-token"), any()))
        .thenReturn(new ScheduleInterviewResult(response(), false));

    mvc.perform(post("/interviews")
            .with(recruiter())
            .contentType(MediaType.APPLICATION_JSON)
            .content(validBody()))
        .andExpect(status().isCreated())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(header().stringValues(
            HttpHeaders.VARY,
            hasItem(HttpHeaders.AUTHORIZATION)))
        .andExpect(header().string("Idempotency-Replayed", "false"))
        .andExpect(jsonPath("$.data.id").value(INTERVIEW_ID.toString()))
        .andExpect(jsonPath("$.data.applicationId").value(APPLICATION_ID.toString()))
        .andExpect(jsonPath("$.data.interviewerId").value(RECRUITER_ID.toString()))
        .andExpect(jsonPath("$.data.status").value("SCHEDULED"));

    verify(scheduling).schedule(
        eq(RECRUITER_ID),
        eq("signed-access-token"),
        any(CreateInterviewRequest.class));
  }

  @Test
  void candidateIsForbiddenBeforeSchedulingServiceRuns() throws Exception {
    mvc.perform(post("/interviews")
            .with(candidate())
            .contentType(MediaType.APPLICATION_JSON)
            .content(validBody()))
        .andExpect(status().isForbidden())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")));

    verifyNoInteractions(scheduling);
  }

  @Test
  void anonymousCallerIsUnauthorizedBeforeSchedulingServiceRuns()
      throws Exception {
    mvc.perform(post("/interviews")
            .contentType(MediaType.APPLICATION_JSON)
            .content(validBody()))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

    verifyNoInteractions(scheduling);
  }

  @Test
  void unknownFieldIsRejectedBeforeSchedulingServiceRuns() throws Exception {
    String body = validBody().replace(
        "\"notes\":\"Bring scorecard\"",
        "\"notes\":\"Bring scorecard\",\"interviewerId\":\""
            + UUID.randomUUID() + "\"");

    mvc.perform(post("/interviews")
            .with(recruiter())
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

    verifyNoInteractions(scheduling);
  }

  @Test
  void invalidBodyIsRejectedBeforeSchedulingServiceRuns() throws Exception {
    String body = """
        {
          "requestId":"%s",
          "roundNumber":0,
          "scheduledStart":"2026-08-29T09:00:00+07:00",
          "timeZone":"",
          "durationMinutes":29,
          "mode":"OFFLINE",
          "location":"Room 2"
        }
        """.formatted(REQUEST_ID);

    mvc.perform(post("/interviews")
            .with(recruiter())
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.details.applicationId").exists())
        .andExpect(jsonPath("$.details.roundNumber").exists())
        .andExpect(jsonPath("$.details.timeZone").exists())
        .andExpect(jsonPath("$.details.durationMinutes").exists());

    verifyNoInteractions(scheduling);
  }

  private static org.springframework.test.web.servlet.request.RequestPostProcessor recruiter() {
    return jwt()
        .jwt(token -> token
            .tokenValue("signed-access-token")
            .subject(RECRUITER_ID.toString())
            .claim("role", "RECRUITER"))
        .authorities(new SimpleGrantedAuthority("ROLE_RECRUITER"));
  }

  private static org.springframework.test.web.servlet.request.RequestPostProcessor candidate() {
    return jwt()
        .jwt(token -> token
            .tokenValue("candidate-access-token")
            .subject(UUID.randomUUID().toString())
            .claim("role", "CANDIDATE"))
        .authorities(new SimpleGrantedAuthority("ROLE_CANDIDATE"));
  }

  private static String validBody() {
    return """
        {
          "applicationId":"%s",
          "requestId":"%s",
          "roundNumber":2,
          "scheduledStart":"2026-08-29T09:00:00+07:00",
          "timeZone":"Asia/Ho_Chi_Minh",
          "durationMinutes":45,
          "mode":"OFFLINE",
          "location":"Room 2",
          "notes":"Bring scorecard"
        }
        """.formatted(APPLICATION_ID, REQUEST_ID);
  }

  private static InterviewResponse response() {
    return new InterviewResponse(
        INTERVIEW_ID,
        APPLICATION_ID,
        7,
        UUID.fromString("623e4567-e89b-42d3-a456-426614174000"),
        UUID.fromString("723e4567-e89b-42d3-a456-426614174000"),
        UUID.fromString("823e4567-e89b-42d3-a456-426614174000"),
        RECRUITER_ID,
        2,
        0,
        Instant.parse("2026-08-29T02:00:00Z"),
        Instant.parse("2026-08-29T02:45:00Z"),
        "Asia/Ho_Chi_Minh",
        45,
        InterviewMode.OFFLINE,
        "Room 2",
        "Bring scorecard",
        InterviewStatus.SCHEDULED,
        Instant.parse("2026-08-28T05:00:00Z"),
        0);
  }

  static final class InterviewSecurityImport implements ImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
      return new String[] {"com.recruitment.interview.config.SecurityConfig"};
    }
  }
}
