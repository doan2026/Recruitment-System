package com.recruitment.interview;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class InterviewServiceApplication {
  public static void main(String[] args) { SpringApplication.run(InterviewServiceApplication.class, args); }
}

@RestController
class HealthController {
  @GetMapping("/health") Map<String, String> health() { return Map.of("service", "interview-service", "status", "UP"); }
}
