package com.recruitment.application.interview;

import com.recruitment.application.api.ApiResponse;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Hidden
@RestController
@RequestMapping("/internal/v1/interview-scheduling")
public class InterviewSchedulingAuthorizationController {
    private final InterviewSchedulingAuthorizationService authorization;

    public InterviewSchedulingAuthorizationController(
        InterviewSchedulingAuthorizationService authorization
    ) {
        this.authorization = authorization;
    }

    @PostMapping("/authorize")
    @PreAuthorize("hasRole('INTERNAL_INTERVIEW') and hasRole('RECRUITER')")
    public ResponseEntity<ApiResponse<InterviewSchedulingContextResponse>>
        authorize(
            JwtAuthenticationToken authentication,
            @Valid @RequestBody AuthorizeInterviewSchedulingRequest request
        ) {
        UUID recruiterId = UUID.fromString(authentication.getName());
        String forwardedAuthorization = "Bearer " +
            authentication.getToken().getTokenValue();
        return ResponseEntity.ok()
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .body(ApiResponse.of(authorization.authorize(
                request.applicationId(),
                recruiterId,
                forwardedAuthorization
            )));
    }
}
