package com.recruitment.auth.controller;

import org.springframework.boot.actuate.health.HealthComponent;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.boot.actuate.health.Status;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
  private final HealthEndpoint healthEndpoint;

  public HealthController(HealthEndpoint healthEndpoint) {
    this.healthEndpoint = healthEndpoint;
  }

  @GetMapping({"/health", "/auth/health"})
  public ResponseEntity<HealthComponent> health() {
    HealthComponent health = healthEndpoint.health();
    boolean unavailable =
        Status.DOWN.equals(health.getStatus())
            || Status.OUT_OF_SERVICE.equals(health.getStatus());
    return ResponseEntity
        .status(unavailable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK)
        .body(health);
  }
}
