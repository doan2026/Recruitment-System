package com.recruitment.auth.repository.jdbc;

import com.recruitment.auth.dto.accountcontrol.AdminUserResponse;
import com.recruitment.auth.model.UserRole;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class AdminUserDirectoryRepository {
  private static final RowMapper<AdminUserResponse> USER_ROW = (row, index) -> new AdminUserResponse(
      row.getObject("id", UUID.class), row.getString("email"), UserRole.valueOf(row.getString("role")),
      row.getBoolean("is_verified"), row.getBoolean("is_locked"), row.getString("locked_reason"),
      row.getTimestamp("created_at"));

  private final JdbcTemplate db;

  public AdminUserDirectoryRepository(JdbcTemplate db) {
    this.db = db;
  }

  public Page<AdminUserResponse> findPage(
      String emailPattern, UserRole role, Boolean locked, Pageable pageable) {
    String where = " WHERE normalized_email LIKE ? ESCAPE '!'";
    List<Object> args = new ArrayList<>();
    args.add(emailPattern);
    if (role != null) {
      where += " AND role=?";
      args.add(role.name());
    }
    if (locked != null) {
      where += " AND is_locked=?";
      args.add(locked);
    }
    Long total = db.queryForObject("SELECT count(*) FROM auth.users" + where, Long.class, args.toArray());
    args.add(pageable.getPageSize());
    args.add(pageable.getOffset());
    List<AdminUserResponse> users = db.query(
        "SELECT id,email,role,is_verified,is_locked,locked_reason,created_at FROM auth.users"
            + where + " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
        USER_ROW, args.toArray());
    return new PageImpl<>(users, pageable, total == null ? 0 : total);
  }
}
