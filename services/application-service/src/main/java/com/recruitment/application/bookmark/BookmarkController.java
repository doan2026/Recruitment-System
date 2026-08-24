package com.recruitment.application.bookmark;

import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/bookmarks")
@PreAuthorize("hasRole('CANDIDATE')")
@SecurityRequirement(name = "bearerAuth")
public class BookmarkController {
    private final BookmarkService bookmarks;

    public BookmarkController(BookmarkService bookmarks) {
        this.bookmarks = bookmarks;
    }

    @PostMapping
    @Operation(summary = "Bookmark an active published job")
    public ResponseEntity<ApiResponse<BookmarkResponse>> create(
        JwtAuthenticationToken authentication,
        @Valid @RequestBody CreateBookmarkRequest request
    ) {
        BookmarkResponse response = bookmarks.create(
            subject(authentication),
            request.jobId()
        );
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ApiResponse.of(response));
    }

    @GetMapping
    @Operation(summary = "List the candidate's bookmarked jobs")
    public ApiResponse<List<BookmarkResponse>> list(
        JwtAuthenticationToken authentication
    ) {
        return ApiResponse.of(bookmarks.list(subject(authentication)));
    }

    @DeleteMapping("/{jobId}")
    @Operation(summary = "Remove a job bookmark")
    public ResponseEntity<Void> delete(
        JwtAuthenticationToken authentication,
        @PathVariable UUID jobId
    ) {
        bookmarks.delete(subject(authentication), jobId);
        return ResponseEntity.noContent().build();
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
