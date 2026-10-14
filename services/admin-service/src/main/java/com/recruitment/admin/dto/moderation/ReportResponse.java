package com.recruitment.admin.dto.moderation;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.recruitment.admin.model.Report;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

public record ReportResponse(UUID id, @JsonProperty("reporter_id") UUID reporterId,
    @JsonProperty("target_type") String targetType, @JsonProperty("target_id") UUID targetId,
    String reason, String description, String status, int version,
    @JsonProperty("handled_by") UUID handledBy, @JsonProperty("handled_at") Timestamp handledAt,
    String resolution, @JsonProperty("operation_id") UUID operationId,
    @JsonProperty("created_at") Timestamp createdAt) {
  public static ReportResponse from(Report report) {
    return new ReportResponse(report.id(), report.reporterId(), report.targetType(), report.targetId(),
        report.reason(), report.description(), report.status(), report.version(), report.handledBy(),
        timestamp(report.handledAt()), report.resolution(), report.operationId(), timestamp(report.createdAt()));
  }

  private static Timestamp timestamp(Instant value) {
    return value == null ? null : Timestamp.from(value);
  }
}
