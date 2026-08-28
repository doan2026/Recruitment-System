package com.recruitment.interview.scheduling;

import com.recruitment.interview.api.ApiResponse;
import com.recruitment.interview.api.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/interviews")
public class InterviewSchedulingController {
    private final InterviewSchedulingService scheduling;

    public InterviewSchedulingController(
        InterviewSchedulingService scheduling
    ) {
        this.scheduling = scheduling;
    }

    @PostMapping
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(
        summary = "Schedule an offline interview for an application",
        security = @SecurityRequirement(name = "bearerAuth")
    )
    public ResponseEntity<ApiResponse<InterviewResponse>> schedule(
        JwtAuthenticationToken authentication,
        @Valid @RequestBody CreateInterviewRequest request
    ) {
        UUID recruiterId;
        try {
            recruiterId = UUID.fromString(authentication.getToken().getSubject());
        } catch (RuntimeException exception) {
            throw new BusinessException(
                "INVALID_TOKEN_SUBJECT",
                "JWT subject must be a UUID",
                HttpStatus.UNAUTHORIZED
            );
        }
        ScheduleInterviewResult result = scheduling.schedule(
            recruiterId,
            authentication.getToken().getTokenValue(),
            request
        );
        return ResponseEntity.status(
                result.replayed() ? HttpStatus.OK : HttpStatus.CREATED
            )
            .cacheControl(CacheControl.noStore().cachePrivate())
            .header(HttpHeaders.PRAGMA, "no-cache")
            .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
            .header(
                "Idempotency-Replayed",
                Boolean.toString(result.replayed())
            )
            .body(ApiResponse.of(result.interview()));
    }
}
