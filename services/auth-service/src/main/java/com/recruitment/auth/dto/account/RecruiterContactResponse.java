package com.recruitment.auth.dto.account;

public record RecruiterContactResponse(String fullName, String phone) {
  @Override
  public String toString() {
    return "RecruiterContactResponse[fullName=<redacted>, phone=<redacted>]";
  }
}
