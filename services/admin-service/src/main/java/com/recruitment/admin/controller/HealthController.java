package com.recruitment.admin.controller;

import com.recruitment.admin.dto.common.HealthResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
  @GetMapping("/health")
  public HealthResponse health() {
    return new HealthResponse("admin-service", "UP");
  }
}
