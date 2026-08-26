package com.recruitment.auth.registration.api;

import com.recruitment.auth.identity.UserRole;

public enum RegistrationRole {
  CANDIDATE,
  RECRUITER;

  public UserRole toUserRole() {
    return UserRole.valueOf(name());
  }
}
