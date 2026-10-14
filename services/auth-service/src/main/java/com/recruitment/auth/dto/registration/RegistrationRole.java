package com.recruitment.auth.dto.registration;

import com.recruitment.auth.model.UserRole;

public enum RegistrationRole {
  CANDIDATE,
  RECRUITER;

  public UserRole toUserRole() {
    return UserRole.valueOf(name());
  }
}
