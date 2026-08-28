package com.recruitment.interview.query;

import com.recruitment.interview.api.ApiResponse;
import com.recruitment.interview.api.BusinessException;
import com.recruitment.interview.query.InterviewQueryModels.Availability;
import com.recruitment.interview.query.InterviewQueryModels.Item;
import com.recruitment.interview.query.InterviewQueryModels.Page;
import com.recruitment.interview.query.InterviewQueryService.AvailabilityQuery;
import com.recruitment.interview.query.InterviewQueryService.CalendarQuery;
import com.recruitment.interview.query.InterviewQueryService.HistoryQuery;
import com.recruitment.interview.query.InterviewQueryService.MyQuery;
import com.recruitment.interview.query.InterviewQueryService.Viewer;
import com.recruitment.interview.query.InterviewQueryService.ViewerRole;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/interviews")
public class InterviewQueryController {
    private static final Set<String> HISTORY_PARAMETERS = Set.of(
        "applicationId",
        "jobId",
        "candidateId",
        "interviewerId",
        "status",
        "limit",
        "cursor"
    );
    private static final Set<String> MY_PARAMETERS = Set.of(
        "period",
        "from",
        "to",
        "status",
        "limit",
        "cursor"
    );
    private static final Set<String> CALENDAR_PARAMETERS = Set.of(
        "from",
        "to",
        "jobId",
        "candidateId",
        "interviewerId",
        "status",
        "limit",
        "cursor"
    );
    private static final Set<String> AVAILABILITY_PARAMETERS = Set.of(
        "applicationId",
        "from",
        "to",
        "timeZone",
        "durationMinutes",
        "limit",
        "cursor"
    );
    private static final Set<String> REPEATABLE_PARAMETERS = Set.of("status");

    private final InterviewQueryService queries;

    public InterviewQueryController(InterviewQueryService queries) {
        this.queries = queries;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('CANDIDATE','RECRUITER')")
    @Operation(
        summary = "List related interview history with keyset pagination",
        security = @SecurityRequirement(name = "bearerAuth")
    )
    public ResponseEntity<ApiResponse<Page>> history(
        JwtAuthenticationToken authentication,
        HttpServletRequest request,
        @RequestParam(required = false) String applicationId,
        @RequestParam(required = false) String jobId,
        @RequestParam(required = false) String candidateId,
        @RequestParam(required = false) String interviewerId,
        @RequestParam(required = false) List<String> status,
        @RequestParam(required = false) String limit,
        @RequestParam(required = false) String cursor
    ) {
        validateParameters(request, HISTORY_PARAMETERS);
        return ok(queries.history(
            viewer(authentication),
            authentication.getToken().getTokenValue(),
            new HistoryQuery(
                applicationId,
                jobId,
                candidateId,
                interviewerId,
                status,
                limit,
                cursor
            )
        ));
    }

    @GetMapping("/my")
    @PreAuthorize("hasAnyRole('CANDIDATE','RECRUITER')")
    @Operation(
        summary = "List the caller's interviews",
        security = @SecurityRequirement(name = "bearerAuth")
    )
    public ResponseEntity<ApiResponse<Page>> my(
        JwtAuthenticationToken authentication,
        HttpServletRequest request,
        @RequestParam(required = false) String period,
        @RequestParam(required = false) String from,
        @RequestParam(required = false) String to,
        @RequestParam(required = false) List<String> status,
        @RequestParam(required = false) String limit,
        @RequestParam(required = false) String cursor
    ) {
        validateParameters(request, MY_PARAMETERS);
        return ok(queries.my(
            viewer(authentication),
            authentication.getToken().getTokenValue(),
            new MyQuery(period, from, to, status, limit, cursor)
        ));
    }

    @GetMapping("/calendar")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(
        summary = "List the current recruiter's company calendar",
        security = @SecurityRequirement(name = "bearerAuth")
    )
    public ResponseEntity<ApiResponse<Page>> calendar(
        JwtAuthenticationToken authentication,
        HttpServletRequest request,
        @RequestParam(required = false) String from,
        @RequestParam(required = false) String to,
        @RequestParam(required = false) String jobId,
        @RequestParam(required = false) String candidateId,
        @RequestParam(required = false) String interviewerId,
        @RequestParam(required = false) List<String> status,
        @RequestParam(required = false) String limit,
        @RequestParam(required = false) String cursor
    ) {
        validateParameters(request, CALENDAR_PARAMETERS);
        return ok(queries.calendar(
            viewer(authentication),
            authentication.getToken().getTokenValue(),
            new CalendarQuery(
                from,
                to,
                jobId,
                candidateId,
                interviewerId,
                status,
                limit,
                cursor
            )
        ));
    }

    @GetMapping("/availability")
    @PreAuthorize("hasRole('RECRUITER')")
    @Operation(
        summary = "Suggest advisory free slots for the caller and Candidate",
        security = @SecurityRequirement(name = "bearerAuth")
    )
    public ResponseEntity<ApiResponse<Availability>> availability(
        JwtAuthenticationToken authentication,
        HttpServletRequest request,
        @RequestParam(required = false) String applicationId,
        @RequestParam(required = false) String from,
        @RequestParam(required = false) String to,
        @RequestParam(required = false) String timeZone,
        @RequestParam(required = false) String durationMinutes,
        @RequestParam(required = false) String limit,
        @RequestParam(required = false) String cursor
    ) {
        validateParameters(request, AVAILABILITY_PARAMETERS);
        return ok(queries.availability(
            viewer(authentication),
            authentication.getToken().getTokenValue(),
            new AvailabilityQuery(
                applicationId,
                from,
                to,
                timeZone,
                durationMinutes,
                limit,
                cursor
            )
        ));
    }

    @GetMapping("/{interviewId}")
    @PreAuthorize("hasAnyRole('CANDIDATE','RECRUITER')")
    @Operation(
        summary = "Get a role-aware interview detail",
        security = @SecurityRequirement(name = "bearerAuth")
    )
    public ResponseEntity<ApiResponse<Item>> detail(
        JwtAuthenticationToken authentication,
        HttpServletRequest request,
        @PathVariable String interviewId
    ) {
        validateParameters(request, Set.of());
        return ok(queries.detail(
            viewer(authentication),
            authentication.getToken().getTokenValue(),
            interviewId
        ));
    }

    private Viewer viewer(JwtAuthenticationToken authentication) {
        UUID id;
        ViewerRole role;
        try {
            id = UUID.fromString(authentication.getToken().getSubject());
            role = ViewerRole.valueOf(
                authentication.getToken().getClaimAsString("role")
            );
        } catch (RuntimeException exception) {
            throw new BusinessException(
                "INVALID_TOKEN_SUBJECT",
                "JWT identity is invalid",
                HttpStatus.UNAUTHORIZED
            );
        }
        return new Viewer(id, role);
    }

    private void validateParameters(
        HttpServletRequest request,
        Set<String> allowed
    ) {
        for (Map.Entry<String, String[]> parameter :
            request.getParameterMap().entrySet()) {
            String name = parameter.getKey();
            String[] values = parameter.getValue();
            if (
                !allowed.contains(name) ||
                values == null ||
                values.length == 0 ||
                (!REPEATABLE_PARAMETERS.contains(name) &&
                    values.length != 1)
            ) {
                throw new BusinessException(
                    "VALIDATION_ERROR",
                    "Request validation failed",
                    HttpStatus.BAD_REQUEST,
                    Map.of(
                        "query",
                        "Unknown or repeated query parameters are invalid"
                    )
                );
            }
        }
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(T data) {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore().cachePrivate())
            .header(HttpHeaders.PRAGMA, "no-cache")
            .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
            .body(ApiResponse.of(data));
    }
}
