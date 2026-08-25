package com.recruitment.application.dashboard;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.time.Instant;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "bearerAuth")
public class RecruiterDashboardController {
    private final RecruiterDashboardService dashboard;

    public RecruiterDashboardController(
        RecruiterDashboardService dashboard
    ) {
        this.dashboard = dashboard;
    }

    @GetMapping("/stats")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(summary = "Get company-wide recruiter application statistics")
    public ApiResponse<RecruiterDashboardResponse> get(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @RequestParam(name = "company_id") UUID companyId,
        @RequestParam(required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
        Instant from,
        @RequestParam(required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
        Instant to,
        @RequestParam(defaultValue = "UTC") String timezone,
        @RequestParam(defaultValue = "DAY")
        DashboardGranularity granularity
    ) {
        return ApiResponse.of(dashboard.get(
            subject(authentication),
            authorization,
            companyId,
            from,
            to,
            timezone,
            granularity
        ));
    }

    private UUID subject(JwtAuthenticationToken authentication) {
        try {
            return UUID.fromString(authentication.getToken().getSubject());
        } catch (RuntimeException exception) {
            throw new BusinessException(
                "INVALID_TOKEN_SUBJECT",
                "JWT subject must be a UUID",
                HttpStatus.UNAUTHORIZED
            );
        }
    }
}
