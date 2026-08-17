package com.recruitment.application;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class ApplicationServiceApplication {
  public static void main(String[] args) { SpringApplication.run(ApplicationServiceApplication.class, args); }
}

@RestController
class HealthController {
  @GetMapping("/health") Map<String, String> health() { return Map.of("service", "application-service", "status", "UP"); }
}
