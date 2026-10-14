package com.recruitment.admin.repository;

import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.model.AuditEntry;
import com.recruitment.admin.model.PageResult;
import com.recruitment.admin.model.Report;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ModerationRepository {
  private static final String REPORT_COLUMNS =
      "id,reporter_id,target_type,target_id,reason,description,status,version,handled_by,handled_at,resolution,operation_id,created_at";
  private static final RowMapper<Report> REPORT_ROW = (row, index) -> new Report(
      row.getObject("id", UUID.class), row.getObject("reporter_id", UUID.class), row.getString("target_type"),
      row.getObject("target_id", UUID.class), row.getString("reason"), row.getString("description"),
      row.getString("status"), row.getInt("version"), row.getObject("handled_by", UUID.class),
      instant(row.getTimestamp("handled_at")), row.getString("resolution"), row.getObject("operation_id", UUID.class),
      instant(row.getTimestamp("created_at")));
  private static final RowMapper<AuditEntry> AUDIT_ROW = (row, index) -> new AuditEntry(
      row.getObject("id", UUID.class), row.getObject("operation_id", UUID.class), row.getObject("admin_id", UUID.class),
      row.getString("action"), row.getString("target_type"), row.getObject("target_id", UUID.class),
      row.getString("reason"), row.getString("outcome"), instant(row.getTimestamp("created_at")));

  private final JdbcTemplate db;

  public ModerationRepository(JdbcTemplate db) {
    this.db = db;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void audit(UUID operation, UUID actor, String action, String type, UUID target, String reason, String outcome) {
    db.update("INSERT INTO admin.audit_log(id,operation_id,admin_id,action,target_type,target_id,reason,outcome) VALUES(?,?,?,?,?,?,?,?)",
        UUID.randomUUID(), operation, actor, action, type, target, reason, outcome);
  }

  @Transactional
  public UUID createReport(UUID actor, String type, UUID target, String reason, String description) {
    // Serialize per reporter so a burst cannot bypass the hourly quota.
    db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, actor.toString());
    Integer count = db.queryForObject(
        "SELECT count(*) FROM admin.reports WHERE reporter_id=? AND created_at>now()-interval '1 hour'", Integer.class, actor);
    if (count != null && count >= 10) throw new AdminFailure(429, "REPORT_RATE_LIMITED");
    UUID id = UUID.randomUUID();
    db.update("INSERT INTO admin.reports(id,reporter_id,target_type,target_id,reason,description) VALUES(?,?,?,?,?,?)",
        id, actor, type, target, reason, description);
    return id;
  }

  @Transactional
  public Report claim(UUID id, int version, UUID actor, String resolution, UUID operation) {
    List<Report> rows = db.query("SELECT " + REPORT_COLUMNS + " FROM admin.reports WHERE id=? FOR UPDATE", REPORT_ROW, id);
    if (rows.isEmpty()) throw new AdminFailure(404, "REPORT_NOT_FOUND");
    Report report = rows.getFirst();
    if (!"OPEN".equals(report.status()) || report.version() != version) {
      throw new AdminFailure(409, "REPORT_VERSION_CONFLICT");
    }
    db.update("UPDATE admin.reports SET status='PROCESSING',version=version+1,handled_by=?,resolution=?,operation_id=? WHERE id=?",
        actor, resolution, operation, id);
    return report;
  }

  @Transactional
  public void finish(UUID id, UUID operation, String status) {
    if (db.update("UPDATE admin.reports SET status=?,version=version+1,handled_at=now() WHERE id=? AND operation_id=? AND status='PROCESSING'",
        status, id, operation) != 1) throw new AdminFailure(409, "REPORT_VERSION_CONFLICT");
  }

  public PageResult<Report> reports(String status, String type, int page, int limit) {
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
    Long total = db.queryForObject("SELECT count(*) FROM admin.reports" + where, Long.class, args.toArray());
    args.add(limit);
    args.add((page - 1) * limit);
    List<Report> rows = db.query("SELECT " + REPORT_COLUMNS + " FROM admin.reports" + where
        + " ORDER BY created_at DESC,id LIMIT ? OFFSET ?", REPORT_ROW, args.toArray());
    return new PageResult<>(rows, total == null ? 0 : total, page, limit);
  }

  public List<AuditEntry> auditEntries(int page, int limit) {
    return db.query("SELECT id,operation_id,admin_id,action,target_type,target_id,reason,outcome,created_at"
        + " FROM admin.audit_log ORDER BY created_at DESC,id LIMIT ? OFFSET ?", AUDIT_ROW, limit, (page - 1) * limit);
  }

  private static Instant instant(Timestamp value) {
    return value == null ? null : value.toInstant();
  }
}
