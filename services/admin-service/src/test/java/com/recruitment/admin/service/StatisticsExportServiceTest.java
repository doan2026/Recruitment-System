package com.recruitment.admin.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.model.DailyStatistic;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class StatisticsExportServiceTest {
  private final StatisticsService statistics = mock(StatisticsService.class);
  private final ServiceGateway gateway = mock(ServiceGateway.class);
  private final StatisticsExportService service = new StatisticsExportService(statistics, gateway);
  private final LocalDate day = LocalDate.of(2026, 10, 14);
  private final Jwt jwt = Jwt.withTokenValue("test").header("alg", "RS256").subject(UUID.randomUUID().toString()).build();

  @Test
  void csvPreservesBomColumnsAndFilename() throws Exception {
    when(statistics.daily(day, day)).thenReturn(List.of(new DailyStatistic(day, "APPLIED", 4)));
    var result = service.export(jwt, "csv", day, day);

    assertEquals("\uFEFFdate,metric,value\r\n2026-10-14,APPLIED,4\r\n", new String(result.content(), StandardCharsets.UTF_8));
    assertEquals("statistics-2026-10-14-2026-10-14.csv", result.filename());
    assertEquals("text/csv;charset=UTF-8", result.contentType());
  }

  @Test
  void xlsxContainsNumericMetricValuesAndUtcHeader() throws Exception {
    when(statistics.daily(day, day)).thenReturn(List.of(new DailyStatistic(day, "HIRED", 3)));
    var result = service.export(jwt, "xlsx", day, day);

    try (var workbook = new XSSFWorkbook(new ByteArrayInputStream(result.content()))) {
      var sheet = workbook.getSheetAt(0);
      assertEquals("Date (UTC)", sheet.getRow(0).getCell(0).getStringCellValue());
      assertEquals("2026-10-14", sheet.getRow(1).getCell(0).getStringCellValue());
      assertEquals("HIRED", sheet.getRow(1).getCell(1).getStringCellValue());
      assertEquals(3.0, sheet.getRow(1).getCell(2).getNumericCellValue());
    }
  }

  @Test
  void invalidTypeIsRejectedBeforeReadingStatistics() {
    assertThrows(AdminFailure.class, () -> service.export(jwt, "pdf", day, day));
    verifyNoInteractions(statistics);
  }

  @Test
  void unauthorizedExportNeverReadsStatistics() {
    doThrow(new AdminFailure(403, "ACCESS_DENIED")).when(gateway).requireCurrentAdmin(jwt);
    assertThrows(AdminFailure.class, () -> service.export(jwt, "csv", day, day));
    verifyNoInteractions(statistics);
  }
}
