package com.recruitment.admin.controller;

import com.recruitment.admin.dto.common.ApiResponse;
import com.recruitment.admin.dto.statistics.FunnelStageResponse;
import com.recruitment.admin.dto.statistics.StatisticsOverviewResponse;
import com.recruitment.admin.service.StatisticsExportService;
import com.recruitment.admin.service.StatisticsService;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/stats")
@SecurityRequirement(name = "bearerAuth")
public class StatisticsController {
  private final StatisticsService statistics;
  private final StatisticsExportService exports;

  public StatisticsController(StatisticsService statistics, StatisticsExportService exports) {
    this.statistics = statistics;
    this.exports = exports;
  }

  @GetMapping("/overview")
  public ApiResponse<StatisticsOverviewResponse> overview(@AuthenticationPrincipal Jwt jwt,
      @RequestParam LocalDate from, @RequestParam LocalDate to) {
    return statistics.overview(jwt, from, to);
  }

  @GetMapping("/funnel")
  public ApiResponse<List<FunnelStageResponse>> funnel(@AuthenticationPrincipal Jwt jwt,
      @RequestParam LocalDate from, @RequestParam LocalDate to) {
    return statistics.funnel(jwt, from, to);
  }

  @GetMapping("/export")
  public ResponseEntity<byte[]> export(@AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "xlsx") String type, @RequestParam LocalDate from,
      @RequestParam LocalDate to) throws IOException {
    var result = exports.export(jwt, type, from, to);
    return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + result.filename())
        .contentType(MediaType.parseMediaType(result.contentType())).body(result.content());
  }
}
