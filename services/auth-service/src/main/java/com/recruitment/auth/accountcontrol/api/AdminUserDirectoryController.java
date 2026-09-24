package com.recruitment.auth.accountcontrol.api;

import com.recruitment.auth.account.CurrentAccountService;
import com.recruitment.auth.api.*;
import com.recruitment.auth.identity.UserRole;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class AdminUserDirectoryController {

  private final JdbcTemplate db;
  private final CurrentAccountService current;

  public AdminUserDirectoryController(
    JdbcTemplate db,
    CurrentAccountService current
  ) {
    this.db = db;
    this.current = current;
  }

  @GetMapping("/auth/users")
  public Object list(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam(defaultValue = "") String email,
    @RequestParam(required = false) UserRole role,
    @RequestParam(required = false) Boolean locked,
    @RequestParam(defaultValue = "1") int page,
    @RequestParam(defaultValue = "20") int limit
  ) {
    if (
      current.get(UUID.fromString(jwt.getSubject())).role() != UserRole.ADMIN
    ) throw new AuthBusinessException(
      "ACCESS_DENIED",
      "Access denied",
      HttpStatus.FORBIDDEN
    );
    if (
      email.length() > 200 ||
      page < 1 ||
      page > 10000 ||
      limit < 1 ||
      limit > 100
    ) throw new AuthBusinessException(
      "VALIDATION_ERROR",
      "Invalid search parameters",
      HttpStatus.BAD_REQUEST
    );
    String q =
      "%" +
      email
        .trim()
        .toLowerCase(Locale.ROOT)
        .replace("!", "!!")
        .replace("%", "!%")
        .replace("_", "!_") +
      "%";
    String where = " WHERE normalized_email LIKE ? ESCAPE '!'";
    List<Object> args = new ArrayList<>();
    args.add(q);
    if (role != null) {
      where += " AND role=?";
      args.add(role.name());
    }
    if (locked != null) {
      where += " AND is_locked=?";
      args.add(locked);
    }
    Long total = db.queryForObject(
      "SELECT count(*) FROM auth.users" + where,
      Long.class,
      args.toArray()
    );
    args.add(limit);
    args.add((page - 1) * limit);
    var rows = db.queryForList(
      "SELECT id,email,role,is_verified,is_locked,locked_reason,created_at FROM auth.users" +
      where +
      " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
      args.toArray()
    );
    return new ApiResponse<>(
      rows,
      Map.of("page", page, "limit", limit, "total", total == null ? 0 : total)
    );
  }
}
