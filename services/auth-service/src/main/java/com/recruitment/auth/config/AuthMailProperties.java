package com.recruitment.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth.mail")
public record AuthMailProperties(String from) {
  public AuthMailProperties {
    if (from == null || from.isBlank() || from.indexOf('\r') >= 0 || from.indexOf('\n') >= 0) {
      throw new IllegalArgumentException("auth.mail.from must be a single non-blank address");
    }
  }
}
