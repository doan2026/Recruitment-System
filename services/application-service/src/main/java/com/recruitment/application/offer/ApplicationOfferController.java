package com.recruitment.application.offer;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.tracking.TrackingViewerRole;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "bearerAuth")
public class ApplicationOfferController {
    private final ApplicationOfferService offers;

    public ApplicationOfferController(ApplicationOfferService offers) {
        this.offers = offers;
    }

    @GetMapping("/offers/{offerId}")
    @PreAuthorize("hasAnyRole('CANDIDATE', 'RECRUITER')")
    @Operation(summary = "Read an authorized offer and current response versions")
    public ResponseEntity<ApiResponse<OfferResponse>> get(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID offerId
    ) {
        boolean recruiter = authentication.getAuthorities().stream()
            .anyMatch(authority -> authority.getAuthority().equals("ROLE_RECRUITER"));
        OfferResponse response = offers.get(
            offerId, subject(authentication),
            recruiter ? TrackingViewerRole.RECRUITER : TrackingViewerRole.CANDIDATE,
            authorization
        );
        return ResponseEntity.ok()
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
            .body(ApiResponse.of(response));
    }

    @PostMapping("/{applicationId}/offer")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(
        summary = "Send an offer for an interviewed application",
        description = "A company MEMBER or OWNER can create one offer for " +
            "an application currently in INTERVIEW."
    )
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "201",
            description = "Offer sent"
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
            description = "Recruiter cannot manage this application"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "404",
            description = "Application was not found"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "409",
            description = "Application state/version conflict or offer exists"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "503",
            description = "Company membership cannot be verified"
        )
    })
    public ResponseEntity<ApiResponse<OfferResponse>> send(
        JwtAuthenticationToken authentication,
        @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
        @PathVariable UUID applicationId,
        @Valid @RequestBody CreateOfferRequest request
    ) {
        OfferResponse response = offers.send(
            applicationId,
            subject(authentication),
            authorization,
            request
        );
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ApiResponse.of(response));
    }

    @PatchMapping("/offers/{offerId}/respond")
    @PreAuthorize("hasRole('CANDIDATE')")
    @Operation(summary = "Accept or decline the candidate's active offer")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "200",
            description = "Offer response recorded"
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
            description = "Candidate does not own the application"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "404",
            description = "Offer or application was not found"
        ),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(
            responseCode = "409",
            description = "Offer expired, already responded, or changed"
        )
    })
    public ApiResponse<OfferResponse> respond(
        JwtAuthenticationToken authentication,
        @PathVariable UUID offerId,
        @Valid @RequestBody RespondOfferRequest request
    ) {
        return ApiResponse.of(offers.respond(
            offerId,
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
