package com.recruitment.application.dashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.recruitment.application.api.GlobalExceptionHandler;
import com.recruitment.application.config.SecurityConfig;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(
    value = RecruiterDashboardController.class,
    properties = "JWT_PUBLIC_KEY_PATH=/tmp/test-public.pem"
)
@Import({SecurityConfig.class, GlobalExceptionHandler.class})
class RecruiterDashboardControllerTest {
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID JOB_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final String TOKEN = "dashboard-token";
    private static final String AUTHORIZATION = "Bearer " + TOKEN;
    private static final Instant GENERATED_AT = Instant.parse(
        "2026-08-25T10:15:30Z"
    );
    private static final Instant FROM = Instant.parse(
        "2026-08-24T17:00:00Z"
    );
    private static final Instant TO = Instant.parse(
        "2026-08-26T17:00:00Z"
    );

    @Autowired
    private MockMvc mvc;

    @MockBean
    private RecruiterDashboardService dashboard;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void recruiterReceivesDashboardAndAllFiltersAreForwarded()
        throws Exception {
        when(dashboard.get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            FROM,
            TO,
            "Asia/Ho_Chi_Minh",
            DashboardGranularity.DAY
        )).thenReturn(response());

        mvc.perform(request(
            RECRUITER_ID.toString(),
            "RECRUITER",
            true
        ))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.companyId")
                .value(COMPANY_ID.toString()))
            .andExpect(jsonPath("$.data.generatedAt")
                .value(GENERATED_AT.toString()))
            .andExpect(jsonPath("$.data.range.from")
                .value(FROM.toString()))
            .andExpect(jsonPath("$.data.range.toExclusive")
                .value(TO.toString()))
            .andExpect(jsonPath("$.data.range.granularity").value("DAY"))
            .andExpect(jsonPath("$.data.range.timezone")
                .value("Asia/Ho_Chi_Minh"))
            .andExpect(jsonPath("$.data.summary.activeJobs.count").value(3))
            .andExpect(jsonPath("$.data.summary.activeJobs.available")
                .value(true))
            .andExpect(jsonPath("$.data.summary.totalApplications")
                .value(7))
            .andExpect(jsonPath("$.data.summary.hiredApplications")
                .value(1))
            .andExpect(jsonPath("$.data.summary.hiredRatePercent")
                .value(14.29))
            .andExpect(jsonPath("$.data.statusCounts.APPLIED").value(1))
            .andExpect(jsonPath("$.data.statusCounts.HIRED").value(1))
            .andExpect(jsonPath("$.data.applicationsByJob[0].jobId")
                .value(JOB_ID.toString()))
            .andExpect(jsonPath("$.data.applicationsByJob[0].jobTitle")
                .value("Backend Engineer"))
            .andExpect(jsonPath("$.data.funnel[1].status")
                .value("REVIEWING"))
            .andExpect(jsonPath("$.data.funnel[1].rateFromPreviousPercent")
                .value(71.43))
            .andExpect(jsonPath("$.data.timeSeries[0].bucketStart")
                .value("2026-08-25"))
            .andExpect(jsonPath("$.data.sourceBreakdown.SEARCH").value(3))
            .andExpect(jsonPath("$.data.warnings").isEmpty())
            .andExpect(jsonPath("$.meta").doesNotExist());

        verify(dashboard).get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            FROM,
            TO,
            "Asia/Ho_Chi_Minh",
            DashboardGranularity.DAY
        );
    }

    @Test
    void omittedOptionalFiltersForwardControllerDefaults() throws Exception {
        when(dashboard.get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            null,
            null,
            "UTC",
            DashboardGranularity.DAY
        )).thenReturn(response());

        mvc.perform(request(
            RECRUITER_ID.toString(),
            "RECRUITER",
            false
        )).andExpect(status().isOk());

        verify(dashboard).get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            null,
            null,
            "UTC",
            DashboardGranularity.DAY
        );
    }

    @Test
    void candidateCannotReadRecruiterDashboard() throws Exception {
        mvc.perform(request(
            UUID.randomUUID().toString(),
            "CANDIDATE",
            false
        )).andExpect(status().isForbidden());

        verifyNoInteractions(dashboard);
    }

    @Test
    void invalidJwtSubjectReturnsUnauthorized() throws Exception {
        mvc.perform(request("not-a-uuid", "RECRUITER", false))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("INVALID_TOKEN_SUBJECT"));

        verifyNoInteractions(dashboard);
    }

    @Test
    void malformedCompanyIdReturnsStandardValidationError() throws Exception {
        stubJwt(RECRUITER_ID.toString(), "RECRUITER");

        mvc.perform(get("/stats")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .param("company_id", "not-a-uuid"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.message")
                .value("Request body or parameter has an invalid format"));

        verifyNoInteractions(dashboard);
    }

    @Test
    void malformedRangeAndGranularityReturnValidationErrors()
        throws Exception {
        stubJwt(RECRUITER_ID.toString(), "RECRUITER");

        mvc.perform(get("/stats")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .param("company_id", COMPANY_ID.toString())
            .param("from", "2026-08-25T00:00:00")
            .param("to", TO.toString()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        mvc.perform(get("/stats")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .param("company_id", COMPANY_ID.toString())
            .param("granularity", "YEAR"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        verifyNoInteractions(dashboard);
    }

    @Test
    void openApiDeclaresBearerSecurityAndOperation() throws Exception {
        Method method = RecruiterDashboardController.class.getMethod(
            "get",
            JwtAuthenticationToken.class,
            String.class,
            UUID.class,
            Instant.class,
            Instant.class,
            String.class,
            DashboardGranularity.class
        );
        SecurityRequirement security = RecruiterDashboardController.class
            .getAnnotation(SecurityRequirement.class);
        Operation operation = method.getAnnotation(Operation.class);

        assertThat(security).isNotNull();
        assertThat(security.name()).isEqualTo("bearerAuth");
        assertThat(operation).isNotNull();
        assertThat(operation.summary())
            .isEqualTo("Get company-wide recruiter application statistics");
    }

    private MockHttpServletRequestBuilder request(
        String subject,
        String role,
        boolean includeFilters
    ) {
        stubJwt(subject, role);
        MockHttpServletRequestBuilder request = get("/stats")
            .header(HttpHeaders.AUTHORIZATION, AUTHORIZATION)
            .param("company_id", COMPANY_ID.toString());
        if (!includeFilters) return request;
        return request
            .param("from", FROM.toString())
            .param("to", TO.toString())
            .param("timezone", "Asia/Ho_Chi_Minh")
            .param("granularity", "DAY");
    }

    private void stubJwt(String subject, String role) {
        when(jwtDecoder.decode(TOKEN)).thenReturn(Jwt
            .withTokenValue(TOKEN)
            .header("alg", "RS256")
            .subject(subject)
            .claim("role", role)
            .issuedAt(GENERATED_AT.minusSeconds(60))
            .expiresAt(GENERATED_AT.plusSeconds(3600))
            .build());
    }

    private RecruiterDashboardResponse response() {
        Map<ApplicationStatus, Long> statuses = Map.of(
            ApplicationStatus.APPLIED, 1L,
            ApplicationStatus.REVIEWING, 1L,
            ApplicationStatus.INTERVIEW, 1L,
            ApplicationStatus.OFFER, 1L,
            ApplicationStatus.HIRED, 1L,
            ApplicationStatus.REJECTED, 1L,
            ApplicationStatus.WITHDRAWN, 1L
        );
        return new RecruiterDashboardResponse(
            COMPANY_ID,
            GENERATED_AT,
            new RecruiterDashboardResponse.DashboardRange(
                FROM,
                TO,
                DashboardGranularity.DAY,
                "Asia/Ho_Chi_Minh"
            ),
            new RecruiterDashboardResponse.DashboardSummary(
                new RecruiterDashboardResponse.ActiveJobs(3L, true),
                7L,
                1L,
                new BigDecimal("14.29")
            ),
            statuses,
            List.of(new RecruiterDashboardResponse.JobApplications(
                JOB_ID,
                "Backend Engineer",
                7L,
                statuses
            )),
            List.of(
                new RecruiterDashboardResponse.FunnelStage(
                    ApplicationStatus.APPLIED,
                    7L,
                    null
                ),
                new RecruiterDashboardResponse.FunnelStage(
                    ApplicationStatus.REVIEWING,
                    5L,
                    new BigDecimal("71.43")
                )
            ),
            List.of(new RecruiterDashboardResponse.TimeSeriesPoint(
                LocalDate.of(2026, 8, 25),
                3L
            )),
            Map.of(ApplicationSource.SEARCH, 3L),
            List.of()
        );
    }
}
