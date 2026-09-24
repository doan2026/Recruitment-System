package com.recruitment.admin;

import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.UriComponentsBuilder;

@RestController
@Validated
@SecurityRequirement(name = "bearerAuth")
class AdminController {

  private final ServiceGateway gateway;
  private final ModerationStore store;
  private final ModerationService moderation;

  AdminController(
    ServiceGateway gateway,
    ModerationStore store,
    ModerationService moderation
  ) {
    this.gateway = gateway;
    this.store = store;
    this.moderation = moderation;
  }

  record Decision(
    @NotNull @Pattern(regexp = "APPROVE|REJECT") String decision,
    @Size(max = 1000) String reason
  ) {}

  record Rejection(@NotBlank @Size(min = 3, max = 1000) String reason) {}

  record Lock(@NotNull Boolean locked, @Size(max = 500) String reason) {}

  record Report(
    @NotNull @Pattern(regexp = "JOB|COMPANY|USER") String targetType,
    @NotNull UUID targetId,
    @NotBlank @Size(min = 3, max = 1000) String reason,
    @Size(max = 5000) String description
  ) {}

  record ResolveReport(
    @NotNull @Pattern(regexp = "RESOLVED|DISMISSED") String status,
    @NotBlank @Size(min = 3, max = 500) String resolution,
    @Min(0) int expectedVersion
  ) {}

  static String reason(String value) {
    if (value == null || value.strip().length() < 3) throw new AdminFailure(
      400,
      "REASON_REQUIRED"
    );
    return value.strip();
  }

  @GetMapping("/companies/pending")
  Object companies(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
    @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit
  ) {
    gateway.requireCurrentAdmin(jwt);
    return gateway.call(
      "COMPANY",
      HttpMethod.GET,
      "/?verified_status=PENDING&page=" + page + "&limit=" + limit,
      null,
      jwt
    );
  }

  @PatchMapping("/companies/{id}/verify")
  Object verify(
    @AuthenticationPrincipal Jwt jwt,
    @PathVariable UUID id,
    @Valid @RequestBody Decision dto
  ) {
    String why = "REJECT".equals(dto.decision()) ? reason(dto.reason()) : null;
    Object body = why == null
      ? Map.of("decision", dto.decision())
      : Map.of("decision", dto.decision(), "reason", why);
    return moderation.mutate(
      jwt,
      "COMPANY",
      id,
      "VERIFY_COMPANY",
      "/" + id + "/verify",
      body,
      why
    );
  }

  @GetMapping("/jobs/pending")
  Object jobs(@AuthenticationPrincipal Jwt jwt) {
    gateway.requireCurrentAdmin(jwt);
    return gateway.call("JOB", HttpMethod.GET, "/pending", null, jwt);
  }

  @PatchMapping("/jobs/{id}/approve")
  Object approve(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
    return moderation.mutate(
      jwt,
      "JOB",
      id,
      "APPROVE_JOB",
      "/" + id + "/approve",
      Map.of(),
      null
    );
  }

  @PatchMapping("/jobs/{id}/reject")
  Object reject(
    @AuthenticationPrincipal Jwt jwt,
    @PathVariable UUID id,
    @Valid @RequestBody Rejection dto
  ) {
    String why = reason(dto.reason());
    return moderation.mutate(
      jwt,
      "JOB",
      id,
      "REJECT_JOB",
      "/" + id + "/reject",
      Map.of("reason", why),
      why
    );
  }

  @GetMapping("/users")
  Object users(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam(defaultValue = "") @Size(max = 200) String email,
    @RequestParam(required = false) @Pattern(
      regexp = "CANDIDATE|RECRUITER|ADMIN"
    ) String role,
    @RequestParam(required = false) Boolean locked,
    @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
    @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit
  ) {
    gateway.requireCurrentAdmin(jwt);
    var uri = UriComponentsBuilder.fromPath("/auth/users")
      .queryParam("email", email)
      .queryParam("page", page)
      .queryParam("limit", limit);
    if (role != null) uri.queryParam("role", role);
    if (locked != null) uri.queryParam("locked", locked);
    return gateway.call(
      "AUTH",
      HttpMethod.GET,
      uri.build().encode().toUriString(),
      null,
      jwt
    );
  }

  @PatchMapping("/users/{id}/lock")
  Object lock(
    @AuthenticationPrincipal Jwt jwt,
    @PathVariable UUID id,
    @Valid @RequestBody Lock dto
  ) {
    String why = dto.locked() ? reason(dto.reason()) : null;
    return moderation.mutate(
      jwt,
      "AUTH",
      id,
      dto.locked() ? "LOCK_USER" : "UNLOCK_USER",
      "/auth/users/" + id + "/lock",
      dto.locked()
        ? Map.of("locked", true, "reason", why)
        : Map.of("locked", false),
      why
    );
  }

  @PostMapping("/reports")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  Object report(
    @AuthenticationPrincipal Jwt jwt,
    @Valid @RequestBody Report dto
  ) {
    return Map.of(
      "data",
      store.createReport(
        UUID.fromString(jwt.getSubject()),
        dto.targetType(),
        dto.targetId(),
        reason(dto.reason()),
        dto.description()
      ),
      "meta",
      Map.of()
    );
  }

  @GetMapping("/reports")
  Object reports(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam(required = false) @Pattern(
      regexp = "OPEN|PROCESSING|RESOLVED|DISMISSED"
    ) String status,
    @RequestParam(required = false) @Pattern(
      regexp = "JOB|COMPANY|USER"
    ) String type,
    @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
    @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit
  ) {
    gateway.requireCurrentAdmin(jwt);
    return store.reports(status, type, page, limit);
  }

  @PatchMapping("/reports/{id}")
  Object resolve(
    @AuthenticationPrincipal Jwt jwt,
    @PathVariable UUID id,
    @Valid @RequestBody ResolveReport dto
  ) {
    return moderation.resolve(jwt, id, dto);
  }

  @GetMapping("/audit-logs")
  Object audit(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam(defaultValue = "1") @Min(1) @Max(10000) int page,
    @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit
  ) {
    gateway.requireCurrentAdmin(jwt);
    return Map.of(
      "data",
      store.db.queryForList(
        "SELECT * FROM admin.audit_log ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
        limit,
        (page - 1) * limit
      ),
      "meta",
      Map.of("page", page, "limit", limit)
    );
  }
}
