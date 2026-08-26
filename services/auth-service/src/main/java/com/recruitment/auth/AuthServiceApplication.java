package com.recruitment.auth;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.actuate.health.HealthComponent;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.boot.actuate.health.Status;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class AuthServiceApplication {
  public static void main(String[] args) {
    SpringApplication.run(AuthServiceApplication.class, args);
  }
}

@RestController
class HealthController {
  private final HealthEndpoint healthEndpoint;

  HealthController(HealthEndpoint healthEndpoint) {
    this.healthEndpoint = healthEndpoint;
  }

  @GetMapping({"/health", "/auth/health"})
  ResponseEntity<HealthComponent> health() {
    HealthComponent health = healthEndpoint.health();
    boolean unavailable =
        Status.DOWN.equals(health.getStatus())
            || Status.OUT_OF_SERVICE.equals(health.getStatus());
    return ResponseEntity
        .status(unavailable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK)
        .body(health);
  }
}
