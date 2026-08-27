package com.recruitment.application.usage;

import com.recruitment.application.api.ApiResponse;
import jakarta.validation.Valid;
import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Hidden
public class CvUsageLookupController {
    private final CvUsageLookupService usages;

    public CvUsageLookupController(CvUsageLookupService usages) {
        this.usages = usages;
    }

    @PostMapping("/internal/v1/cv-usages/lookup")
    @PreAuthorize("hasAuthority('ROLE_INTERNAL_PROFILE')")
    public ResponseEntity<ApiResponse<CvUsageLookupResponse>> lookup(
        @Valid @RequestBody CvUsageLookupRequest request
    ) {
        return ResponseEntity.ok(ApiResponse.of(usages.lookup(request)));
    }
}
