package com.recruitment.application.evaluation;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import java.util.UUID;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "bearerAuth")
public class ApplicationEvaluationController {
    private final ApplicationEvaluationService evaluations;

    public ApplicationEvaluationController(
        ApplicationEvaluationService evaluations
    ) {
        this.evaluations = evaluations;
    }

    @GetMapping("/{applicationId}/evaluations")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(summary = "Read internal evaluations for an authorized company application")
    public ResponseEntity<ApiResponse<List<EvaluationResponse>>> list(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID applicationId
    ) {
        return ResponseEntity.ok()
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
            .body(ApiResponse.of(evaluations.list(
                applicationId, subject(authentication), authorization
            )));
    }

    @PostMapping("/{applicationId}/evaluation")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(
        summary = "Create an internal evaluation for an application",
        description = "MEMBER and OWNER can evaluate applications belonging " +
            "to any job in their company. Candidates never receive this data."
    )
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "201",
            description = "Evaluation created"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "400",
            description = "Request validation failed"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "401",
            description = "Authentication is missing or invalid"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "403",
            description = "Recruiter cannot evaluate this application"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "404",
            description = "Application was not found"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "409",
            description = "Recruiter has already evaluated the application"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "503",
            description = "Company membership cannot be verified"
        )
    })
    public ResponseEntity<ApiResponse<EvaluationResponse>> create(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID applicationId,
        @Valid @RequestBody CreateEvaluationRequest request
    ) {
        EvaluationResponse response = evaluations.create(
            applicationId,
            subject(authentication),
            authorization,
            request
        );
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ApiResponse.of(response));
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
