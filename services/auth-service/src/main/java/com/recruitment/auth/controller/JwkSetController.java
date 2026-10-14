package com.recruitment.auth.controller;

import com.recruitment.auth.security.token.JwkSetService;
import java.time.Duration;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth/.well-known")
public class JwkSetController {
  private final JwkSetService jwkSetService;

  JwkSetController(JwkSetService jwkSetService) {
    this.jwkSetService = jwkSetService;
  }

  @GetMapping(value = "/jwks.json", produces = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<Map<String, Object>> jwks() {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic().mustRevalidate())
        .body(jwkSetService.publicJwkSet());
  }
}
