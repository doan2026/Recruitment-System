package com.recruitment.auth.identity;

public enum RefreshSessionRevocationReason {
  ROTATED,
  LOGOUT,
  REUSE_DETECTED,
  PASSWORD_RESET,
  ADMIN_LOCK,
  EXPIRED
}
