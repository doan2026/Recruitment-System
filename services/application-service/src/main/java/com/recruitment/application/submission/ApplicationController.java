package com.recruitment.application.submission;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ApplicationController {
    private final SubmissionService submissions;

    public ApplicationController(SubmissionService submissions) {
        this.submissions = submissions;
    }

    @PostMapping
    @PreAuthorize("hasRole('CANDIDATE')")
    @Operation(
        summary = "Submit an application for a published job",
        security = @SecurityRequirement(name = "bearerAuth")
    )
    public ResponseEntity<ApiResponse<ApplicationResponse>> submit(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @Valid @RequestBody CreateApplicationRequest request
    ) {
        UUID candidateId;
        try {
            candidateId = UUID.fromString(authentication.getToken().getSubject());
        } catch (RuntimeException exception) {
            throw new BusinessException(
                "INVALID_TOKEN_SUBJECT",
                "JWT subject must be a UUID",
                HttpStatus.UNAUTHORIZED
            );
        }
        ApplicationResponse response = submissions.submit(
            candidateId,
            authorization,
            request
        );
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ApiResponse.of(response));
    }
}
