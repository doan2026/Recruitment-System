package com.recruitment.admin;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
class ModerationService {

  private final ServiceGateway gateway;
  private final ModerationStore store;

  ModerationService(ServiceGateway gateway, ModerationStore store) {
    this.gateway = gateway;
    this.store = store;
  }

  JsonNode mutate(
    Jwt actor,
    String service,
    UUID target,
    String action,
    String path,
    Object body,
    String reason
  ) {
    gateway.requireCurrentAdmin(actor);
    UUID operation = UUID.randomUUID(), admin = UUID.fromString(
      actor.getSubject()
    );
    // Commit intent before the remote call; append-only outcome survives partial failure.
    store.audit(operation, admin, action, service, target, reason, "STARTED");
    try {
      JsonNode result = gateway.call(
        service,
        HttpMethod.PATCH,
        path,
        body,
        actor
      );
      store.audit(
        operation,
        admin,
        action,
        service,
        target,
        reason,
        "SUCCEEDED"
      );
      return result;
    } catch (AdminFailure e) {
      store.audit(
        operation,
        admin,
        action,
        service,
        target,
        reason,
        e.status >= 500 ? "UNKNOWN" : "FAILED"
      );
      throw e;
    }
  }

  Object resolve(Jwt actor, UUID id, AdminController.ResolveReport dto) {
    gateway.requireCurrentAdmin(actor);
    UUID op = UUID.randomUUID(), admin = UUID.fromString(actor.getSubject());
    var report = store.claim(
      id,
      dto.expectedVersion(),
      admin,
      dto.resolution(),
      op
    );
    String type = (String) report.get("target_type");
    UUID target = (UUID) report.get("target_id");
    store.audit(
      op,
      admin,
      "HANDLE_REPORT",
      "REPORT",
      id,
      dto.resolution(),
      "STARTED"
    );
    try {
      if ("RESOLVED".equals(dto.status())) {
        if ("USER".equals(type)) gateway.call(
          "AUTH",
          HttpMethod.PATCH,
          "/auth/users/" + target + "/lock",
          Map.of("locked", true, "reason", dto.resolution()),
          actor
        );
        else throw new AdminFailure(409, "TAKEDOWN_CONTRACT_UNAVAILABLE");
      }
      store.finish(id, op, dto.status());
      store.audit(
        op,
        admin,
        "HANDLE_REPORT",
        "REPORT",
        id,
        dto.resolution(),
        "SUCCEEDED"
      );
    } catch (AdminFailure e) {
      // Never claim success on an ambiguous timeout; PROCESSING requires reconciliation.
      if (e.status < 500) store.finish(id, op, "OPEN");
      store.audit(
        op,
        admin,
        "HANDLE_REPORT",
        "REPORT",
        id,
        dto.resolution(),
        e.status >= 500 ? "UNKNOWN" : "FAILED"
      );
      throw e;
    }
    return Map.of(
      "data",
      Map.of("id", id, "status", dto.status()),
      "meta",
      Map.of()
    );
  }
}
