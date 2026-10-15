package com.recruitment.auth.service.token;

import java.time.Instant;
import org.springframework.stereotype.Component;

@Component
class TokenTimeSource {
  Instant now() {
    return Instant.now();
  }
}
