package com.recruitment.auth.oauth;

import com.recruitment.auth.identity.UserRole;

public enum GoogleOAuthRole {
  CANDIDATE,
  RECRUITER;

  UserRole toUserRole() {
    return UserRole.valueOf(name());
  }
}
