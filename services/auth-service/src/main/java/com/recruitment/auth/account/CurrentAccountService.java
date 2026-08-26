package com.recruitment.auth.account;

import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.account.api.CurrentAccountResponse;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CurrentAccountService {
  private final AuthUserRepository users;

  public CurrentAccountService(AuthUserRepository users) {
    this.users = users;
  }

  @Transactional(readOnly = true)
  public CurrentAccountResponse get(UUID userId) {
    AuthUser user = users.findById(userId).orElseThrow(this::invalidAccessToken);
    if (!user.isVerified()) {
      throw new AuthBusinessException(
          "ACCOUNT_NOT_VERIFIED",
          "Account verification is required",
          HttpStatus.FORBIDDEN);
    }
    if (user.isLocked()) {
      throw new AuthBusinessException(
          "ACCOUNT_LOCKED",
          "Account is locked",
          HttpStatus.FORBIDDEN);
    }
    return new CurrentAccountResponse(
        user.getId(),
        user.getEmail(),
        user.getRole(),
        true);
  }

  private AuthBusinessException invalidAccessToken() {
    return new AuthBusinessException(
        "ACCESS_TOKEN_INVALID",
        "Access token is no longer valid",
        HttpStatus.UNAUTHORIZED);
  }
}
