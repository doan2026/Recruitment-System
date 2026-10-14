package com.recruitment.auth.dto.oauth;

import com.recruitment.auth.model.UserRole;

public enum GoogleOAuthRole {
  CANDIDATE,
  RECRUITER;

  public UserRole toUserRole() {
    return UserRole.valueOf(name());
  }
}
