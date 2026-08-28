package com.recruitment.application.pipeline;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.domain.ApplicationStatus;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "bearerAuth")
public class ApplicationPipelineController {
    private final ApplicationPipelineService pipeline;

    public ApplicationPipelineController(ApplicationPipelineService pipeline) {
        this.pipeline = pipeline;
    }

    @GetMapping
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(summary = "Filter applications belonging to recruiter company")
    public ResponseEntity<ApiResponse<RecruiterApplicationPageResponse>> list(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @RequestParam(name = "job_id", required = false) UUID jobId,
        @RequestParam(required = false) ApplicationStatus status,
        @RequestParam(required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
        Instant appliedFrom,
        @RequestParam(required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
        Instant appliedTo,
        @RequestParam(name = "skills", required = false)
        List<String> skills,
        @RequestParam(defaultValue = "APPLIED_AT_DESC")
        ApplicationSort sort,
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size
    ) {
        return ResponseEntity.ok()
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
            .body(ApiResponse.of(pipeline.listForRecruiter(
                subject(authentication),
                authorization,
                jobId,
                status,
                appliedFrom,
                appliedTo,
                skills,
                sort,
                page,
                size
            )));
    }

    @PatchMapping("/{applicationId}/status")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(summary = "Move an application through recruiter pipeline")
    public ApiResponse<StatusTransitionResponse> changeStatus(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID applicationId,
        @Valid @RequestBody ChangeApplicationStatusRequest request
    ) {
        return ApiResponse.of(pipeline.changeStatus(
            applicationId,
            subject(authentication),
            authorization,
            request
        ));
    }

    @PatchMapping("/{applicationId}/withdraw")
    @PreAuthorize("hasRole('CANDIDATE')")
    @Operation(summary = "Withdraw the candidate's active application")
    public ApiResponse<StatusTransitionResponse> withdraw(
        JwtAuthenticationToken authentication,
        @PathVariable UUID applicationId,
        @Valid @RequestBody WithdrawApplicationRequest request
    ) {
        return ApiResponse.of(pipeline.withdraw(
            applicationId,
            subject(authentication),
            request
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
