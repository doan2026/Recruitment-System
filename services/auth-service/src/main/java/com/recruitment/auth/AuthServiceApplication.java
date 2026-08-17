package com.recruitment.auth;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class AuthServiceApplication {
  public static void main(String[] args) { SpringApplication.run(AuthServiceApplication.class, args); }
}

@RestController
class HealthController {
  @GetMapping("/health") Map<String, String> health() { return Map.of("service", "auth-service", "status", "UP"); }
}
