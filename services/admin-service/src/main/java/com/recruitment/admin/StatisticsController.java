package com.recruitment.admin;

import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/stats")
@SecurityRequirement(name = "bearerAuth")
class StatisticsController {

  private final StatisticsService stats;
  private final ServiceGateway gateway;

  StatisticsController(StatisticsService stats, ServiceGateway gateway) {
    this.stats = stats;
    this.gateway = gateway;
  }

  @GetMapping("/overview")
  Object overview(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam LocalDate from,
    @RequestParam LocalDate to
  ) {
    gateway.requireCurrentAdmin(jwt);
    return stats.overview(from, to);
  }

  @GetMapping("/funnel")
  Object funnel(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam LocalDate from,
    @RequestParam LocalDate to
  ) {
    gateway.requireCurrentAdmin(jwt);
    return stats.funnel(from, to);
  }

  @GetMapping("/export")
  ResponseEntity<byte[]> export(
    @AuthenticationPrincipal Jwt jwt,
    @RequestParam(defaultValue = "xlsx") String type,
    @RequestParam LocalDate from,
    @RequestParam LocalDate to
  ) throws IOException {
    gateway.requireCurrentAdmin(jwt);
    if (!Set.of("csv", "xlsx").contains(type)) throw new AdminFailure(
      400,
      "EXPORT_TYPE_INVALID"
    );
    var rows = stats.daily(from, to);
    byte[] bytes;
    if (type.equals("csv")) {
      var csv = new StringBuilder("\uFEFFdate,metric,value\r\n");
      for (var row : rows) csv
        .append(row.get("stat_date"))
        .append(',')
        .append(row.get("metric"))
        .append(',')
        .append(row.get("value"))
        .append("\r\n");
      bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
    } else {
      try (
        var workbook = new XSSFWorkbook();
        var output = new ByteArrayOutputStream()
      ) {
        var sheet = workbook.createSheet("Daily statistics");
        var header = sheet.createRow(0);
        header.createCell(0).setCellValue("Date (UTC)");
        header.createCell(1).setCellValue("Metric");
        header.createCell(2).setCellValue("Value");
        int index = 1;
        for (var item : rows) {
          var row = sheet.createRow(index++);
          row.createCell(0).setCellValue(item.get("stat_date").toString());
          row.createCell(1).setCellValue(item.get("metric").toString());
          row
            .createCell(2)
            .setCellValue(((Number) item.get("value")).doubleValue());
        }
        sheet.createFreezePane(0, 1);
        sheet.setColumnWidth(0, 4000);
        sheet.setColumnWidth(1, 6000);
        sheet.setColumnWidth(2, 4000);
        workbook.write(output);
        bytes = output.toByteArray();
      }
    }
    return ResponseEntity.ok()
      .header(
        HttpHeaders.CONTENT_DISPOSITION,
        "attachment; filename=statistics-" + from + "-" + to + "." + type
      )
      .contentType(
        MediaType.parseMediaType(
          type.equals("csv")
            ? "text/csv;charset=UTF-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
      )
      .body(bytes);
  }
}
