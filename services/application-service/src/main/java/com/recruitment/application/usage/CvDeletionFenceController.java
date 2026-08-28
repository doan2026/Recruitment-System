package com.recruitment.application.usage;

import com.recruitment.application.api.ApiResponse;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Hidden
public class CvDeletionFenceController {
    private final CvDeletionFenceService fences;

    public CvDeletionFenceController(CvDeletionFenceService fences) {
        this.fences = fences;
    }

    @PostMapping("/internal/v1/cv-deletion-fences/acquire")
    @PreAuthorize("hasAuthority('ROLE_INTERNAL_PROFILE')")
    public ResponseEntity<ApiResponse<CvDeletionFenceResponse>> acquire(
        @Valid @RequestBody CvDeletionFenceRequest request
    ) {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(ApiResponse.of(fences.acquire(request)));
    }
}
