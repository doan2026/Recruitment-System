package com.recruitment.admin;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.*;

@Repository
class ModerationStore {

  final JdbcTemplate db;

  ModerationStore(JdbcTemplate db) {
    this.db = db;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void audit(
    UUID op,
    UUID actor,
    String action,
    String type,
    UUID target,
    String reason,
    String outcome
  ) {
    db.update(
      "INSERT INTO admin.audit_log(id,operation_id,admin_id,action,target_type,target_id,reason,outcome) VALUES(?,?,?,?,?,?,?,?)",
      UUID.randomUUID(),
      op,
      actor,
      action,
      type,
      target,
      reason,
      outcome
    );
  }

  @Transactional
  public Map<String, Object> createReport(
    UUID actor,
    String type,
    UUID target,
    String reason,
    String description
  ) {
    // Serialize per reporter so a burst cannot bypass the hourly quota.
    db.queryForObject(
      "SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
      Object.class,
      actor.toString()
    );
    Integer count = db.queryForObject(
      "SELECT count(*) FROM admin.reports WHERE reporter_id=? AND created_at>now()-interval '1 hour'",
      Integer.class,
      actor
    );
    if (count != null && count >= 10) throw new AdminFailure(
      429,
      "REPORT_RATE_LIMITED"
    );
    UUID id = UUID.randomUUID();
    db.update(
      "INSERT INTO admin.reports(id,reporter_id,target_type,target_id,reason,description) VALUES(?,?,?,?,?,?)",
      id,
      actor,
      type,
      target,
      reason,
      description
    );
    return Map.of("id", id, "status", "OPEN", "version", 0);
  }

  @Transactional
  public Map<String, Object> claim(
    UUID id,
    int version,
    UUID actor,
    String resolution,
    UUID operation
  ) {
    var rows = db.queryForList(
      "SELECT * FROM admin.reports WHERE id=? FOR UPDATE",
      id
    );
    if (rows.isEmpty()) throw new AdminFailure(404, "REPORT_NOT_FOUND");
    var row = rows.getFirst();
    if (
      !"OPEN".equals(row.get("status")) ||
      ((Number) row.get("version")).intValue() != version
    ) throw new AdminFailure(409, "REPORT_VERSION_CONFLICT");
    db.update(
      "UPDATE admin.reports SET status='PROCESSING',version=version+1,handled_by=?,resolution=?,operation_id=? WHERE id=?",
      actor,
      resolution,
      operation,
      id
    );
    return row;
  }

  @Transactional
  public void finish(UUID id, UUID operation, String status) {
    if (
      db.update(
        "UPDATE admin.reports SET status=?,version=version+1,handled_at=now() WHERE id=? AND operation_id=? AND status='PROCESSING'",
        status,
        id,
        operation
      ) !=
      1
    ) throw new AdminFailure(409, "REPORT_VERSION_CONFLICT");
  }

  Map<String, Object> reports(String status, String type, int page, int limit) {
    String where = " WHERE 1=1";
    List<Object> args = new ArrayList<>();
    if (status != null) {
      where += " AND status=?";
      args.add(status);
    }
    if (type != null) {
      where += " AND target_type=?";
      args.add(type);
    }
    Long total = db.queryForObject(
      "SELECT count(*) FROM admin.reports" + where,
      Long.class,
      args.toArray()
    );
    args.add(limit);
    args.add((page - 1) * limit);
    var rows = db.queryForList(
      "SELECT * FROM admin.reports" +
      where +
      " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
      args.toArray()
    );
    return Map.of(
      "data",
      rows,
      "meta",
      Map.of("page", page, "limit", limit, "total", total == null ? 0 : total)
    );
  }
}
