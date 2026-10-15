package com.recruitment.admin.support;

import com.recruitment.admin.exception.AdminFailure;

public final class ModerationReason {
  private ModerationReason() {}

  public static String require(String value) {
    if (value == null || value.strip().length() < 3) {
      throw new AdminFailure(400, "REASON_REQUIRED");
    }
    return value.strip();
  }
}
