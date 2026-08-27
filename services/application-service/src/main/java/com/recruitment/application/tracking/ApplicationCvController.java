package com.recruitment.application.tracking;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "bearerAuth")
public class ApplicationCvController {
    private final ApplicationCvService cvs;

    public ApplicationCvController(ApplicationCvService cvs) {
        this.cvs = cvs;
    }

    @GetMapping("/{applicationId}/cv")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(summary = "Get the immutable CV revision for an application")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "CV metadata"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid request"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Unauthenticated"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Access denied"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Application not found"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "502", description = "Invalid Profile response"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "503", description = "Profile unavailable")
    })
    public ResponseEntity<ApiResponse<ApplicationCvResponse>> getCv(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID applicationId
    ) {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(ApiResponse.of(cvs.getCv(
                applicationId,
                subject(authentication),
                authorization
            )));
    }

    @PostMapping("/{applicationId}/cv/download-url")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(summary = "Create a short-lived CV download URL")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Download URL"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid request"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Unauthenticated"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Access denied"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Application not found"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "502", description = "Invalid Profile response"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "503", description = "Profile unavailable")
    })
    public ResponseEntity<ApiResponse<ApplicationCvDownloadResponse>> download(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID applicationId
    ) {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(ApiResponse.of(cvs.createDownloadUrl(
                applicationId,
                subject(authentication),
                authorization
            )));
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
