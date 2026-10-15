package com.recruitment.auth.service.accountcontrol;

import com.recruitment.auth.dto.accountcontrol.AdminUserResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jdbc.AdminUserDirectoryRepository;
import com.recruitment.auth.service.account.CurrentAccountService;
import java.util.Locale;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminUserDirectoryService {
  private final AdminUserDirectoryRepository directory;
  private final CurrentAccountService current;

  public AdminUserDirectoryService(
      AdminUserDirectoryRepository directory, CurrentAccountService current) {
    this.directory = directory;
    this.current = current;
  }

  @Transactional(readOnly = true)
  public Page<AdminUserResponse> list(
      UUID actingUserId, String email, UserRole role, Boolean locked, int page, int limit) {
    // Recheck durable role/lock state instead of trusting a previously issued JWT.
    if (current.get(actingUserId).role() != UserRole.ADMIN) {
      throw new AuthBusinessException("ACCESS_DENIED", "Access denied", HttpStatus.FORBIDDEN);
    }
    if (email == null || email.length() > 200 || page < 1 || page > 10000 || limit < 1 || limit > 100) {
      throw new AuthBusinessException(
          "VALIDATION_ERROR", "Invalid search parameters", HttpStatus.BAD_REQUEST);
    }
    String pattern = "%" + email.trim().toLowerCase(Locale.ROOT)
        .replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
    return directory.findPage(pattern, role, locked, PageRequest.of(page - 1, limit));
  }
}
