package com.recruitment.application.tracking;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "bearerAuth")
public class ApplicationTrackingController {
    private final ApplicationTrackingService tracking;

    public ApplicationTrackingController(ApplicationTrackingService tracking) {
        this.tracking = tracking;
    }

    @GetMapping("/my")
    @PreAuthorize("hasRole('CANDIDATE')")
    @Operation(summary = "List the authenticated candidate's applications")
    public ApiResponse<List<ApplicationListItemResponse>> listMine(
        JwtAuthenticationToken authentication
    ) {
        return ApiResponse.of(tracking.listMine(subject(authentication)));
    }

    @GetMapping("/{applicationId}")
    @PreAuthorize("hasAnyRole('CANDIDATE', 'RECRUITER')")
    @Operation(summary = "Get an authorized application and its timeline")
    public ApiResponse<ApplicationDetailResponse> getDetail(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID applicationId
    ) {
        return ApiResponse.of(tracking.getDetail(
            applicationId,
            subject(authentication),
            viewerRole(authentication),
            authorization
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

    private TrackingViewerRole viewerRole(
        JwtAuthenticationToken authentication
    ) {
        boolean recruiter = authentication.getAuthorities().stream()
            .anyMatch(authority ->
                authority.getAuthority().equals("ROLE_RECRUITER")
            );
        return recruiter
            ? TrackingViewerRole.RECRUITER
            : TrackingViewerRole.CANDIDATE;
    }
}
