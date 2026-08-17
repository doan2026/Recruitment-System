package com.recruitment.admin;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class AdminServiceApplication {
  public static void main(String[] args) { SpringApplication.run(AdminServiceApplication.class, args); }
}

@RestController
class HealthController {
  @GetMapping("/health") Map<String, String> health() { return Map.of("service", "admin-service", "status", "UP"); }
}
