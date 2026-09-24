package com.recruitment.admin;

import com.fasterxml.jackson.databind.*;
import java.time.*;
import java.util.*;

final class StatEventParser {

  record Event(UUID id, UUID entity, String metric, Instant time) {}

  static Event parse(String topic, JsonNode node) {
    if (
      !node.isObject() ||
      !node.path("schema_version").isIntegralNumber() ||
      node.path("schema_version").asInt() != 1 ||
      !node.path("aggregate_version").isIntegralNumber() ||
      node.path("aggregate_version").asLong() < 0
    ) throw new IllegalArgumentException();
    UUID id = UUID.fromString(text(node, "event_id"));
    Instant at = OffsetDateTime.parse(text(node, "occurred_at")).toInstant();
    if (
      at.isAfter(Instant.now().plusSeconds(300))
    ) throw new IllegalArgumentException();
    String metric = null, action = text(node, "action");
    UUID entity;
    if (topic.equals("job-events")) {
      entity = UUID.fromString(text(node, "job_id"));
      if (
        !Set.of("CREATED", "UPDATED", "CLOSED", "EXPIRED").contains(action)
      ) throw new IllegalArgumentException();
      String status = text(node, "status");
      if (
        !Set.of(
          "DRAFT",
          "PENDING_APPROVAL",
          "PUBLISHED",
          "CLOSED",
          "EXPIRED"
        ).contains(status)
      ) throw new IllegalArgumentException();
      if (status.equals("PUBLISHED")) metric = "JOBS_PUBLISHED";
    } else if (topic.equals("application-events")) {
      entity = UUID.fromString(text(node, "application_id"));
      if (
        !Set.of("STATUS_CHANGED", "OFFER_SENT").contains(action)
      ) throw new IllegalArgumentException();
      String status = text(node, "to_status");
      if (
        !Set.of(
          "APPLIED",
          "REVIEWING",
          "INTERVIEW",
          "OFFER",
          "HIRED",
          "REJECTED",
          "WITHDRAWN"
        ).contains(status)
      ) throw new IllegalArgumentException();
      if (
        Set.of("APPLIED", "INTERVIEW", "OFFER", "HIRED").contains(status)
      ) metric = status;
    } else throw new IllegalArgumentException();
    return new Event(id, entity, metric, at);
  }

  private static String text(JsonNode node, String key) {
    if (
      !node.path(key).isTextual() || node.path(key).asText().isBlank()
    ) throw new IllegalArgumentException();
    return node.path(key).asText();
  }
}
