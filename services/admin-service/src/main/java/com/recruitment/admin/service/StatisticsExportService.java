package com.recruitment.admin.service;

import com.recruitment.admin.dto.statistics.StatisticsExport;
import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Set;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
public class StatisticsExportService {
  private final StatisticsService statistics;
  private final ServiceGateway gateway;

  public StatisticsExportService(StatisticsService statistics, ServiceGateway gateway) {
    this.statistics = statistics;
    this.gateway = gateway;
  }

  public StatisticsExport export(Jwt actor, String type, LocalDate from, LocalDate to) throws IOException {
    gateway.requireCurrentAdmin(actor);
    if (!Set.of("csv", "xlsx").contains(type)) throw new AdminFailure(400, "EXPORT_TYPE_INVALID");
    var rows = statistics.daily(from, to);
    byte[] bytes;
    if (type.equals("csv")) {
      var csv = new StringBuilder("\uFEFFdate,metric,value\r\n");
      for (var row : rows) csv.append(row.date()).append(',').append(row.metric()).append(',').append(row.value()).append("\r\n");
      bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
    } else {
      try (var workbook = new XSSFWorkbook(); var output = new ByteArrayOutputStream()) {
        var sheet = workbook.createSheet("Daily statistics");
        var header = sheet.createRow(0);
        header.createCell(0).setCellValue("Date (UTC)");
        header.createCell(1).setCellValue("Metric");
        header.createCell(2).setCellValue("Value");
        int index = 1;
        for (var item : rows) {
          var row = sheet.createRow(index++);
          row.createCell(0).setCellValue(item.date().toString());
          row.createCell(1).setCellValue(item.metric());
          row.createCell(2).setCellValue((double) item.value());
        }
        sheet.createFreezePane(0, 1);
        sheet.setColumnWidth(0, 4000);
        sheet.setColumnWidth(1, 6000);
        sheet.setColumnWidth(2, 4000);
        workbook.write(output);
        bytes = output.toByteArray();
      }
    }
    return new StatisticsExport(bytes, "statistics-" + from + "-" + to + "." + type,
        type.equals("csv") ? "text/csv;charset=UTF-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
}
