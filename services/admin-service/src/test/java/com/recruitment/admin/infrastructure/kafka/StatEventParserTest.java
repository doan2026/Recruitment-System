package com.recruitment.admin.infrastructure.kafka;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.service.StatisticsService;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class StatEventParserTest {

  final ObjectMapper mapper = new ObjectMapper();

  String event(String extra) {
    return (
      """
      {"event_id":"d129c346-41c4-4f4b-99d4-58f2f2c519d3","schema_version":1,"aggregate_version":1,
      "occurred_at":"2026-08-20T10:00:00+07:00",
      """ +
      extra +
      "}"
    );
  }

  @Test
  void parsesPublishedJobInsteadOfCountingDraftCreation() throws Exception {
    var published = StatEventParser.parse(
      "job-events",
      mapper.readTree(
        event(
          """
          "action":"UPDATED","job_id":"768f2f86-7826-4a5b-90cf-1c2741a34e18","status":"PUBLISHED"
          """
        )
      )
    );
    assertEquals("JOBS_PUBLISHED", published.metric());
    assertEquals("2026-08-20T03:00:00Z", published.time().toString());
    assertNull(
      StatEventParser.parse(
        "job-events",
        mapper.readTree(
          event(
            """
            "action":"CREATED","job_id":"768f2f86-7826-4a5b-90cf-1c2741a34e18","status":"DRAFT"
            """
          )
        )
      ).metric()
    );
  }

  @Test
  void countsOfferSentAndStatusChangedUnderSameStage() throws Exception {
    for (String action : new String[] { "STATUS_CHANGED", "OFFER_SENT" }) {
      var e = StatEventParser.parse(
        "application-events",
        mapper.readTree(
          event(
            "\"action\":\"" +
            action +
            "\",\"application_id\":\"768f2f86-7826-4a5b-90cf-1c2741a34e18\",\"to_status\":\"OFFER\""
          )
        )
      );
      assertEquals("OFFER", e.metric());
    }
  }

  @Test
  void rejectsMalformedAndFutureEvents() throws Exception {
    for (String json : new String[] {
      "{}",
      "[]",
      event("\"action\":\"UPSERTED\""),
      event(
        "\"action\":\"UPDATED\",\"job_id\":\"invalid\",\"status\":\"PUBLISHED\""
      ),
      event(
        "\"action\":\"UPDATED\",\"job_id\":\"768f2f86-7826-4a5b-90cf-1c2741a34e18\",\"status\":\"PUBLISHED\""
      ).replace("2026-08-20", "2099-08-20"),
    }) {
      var node = mapper.readTree(json);
      assertThrows(IllegalArgumentException.class, () ->
        StatEventParser.parse("job-events", node)
      );
    }
  }

  @Test
  void rejectsReversedOrUnboundedExportRange() {
    var start = LocalDate.of(2026, 1, 1);
    assertThrows(AdminFailure.class, () ->
      StatisticsService.range(start, start.minusDays(1))
    );
    assertThrows(AdminFailure.class, () ->
      StatisticsService.range(start, start.plusDays(367))
    );
    assertDoesNotThrow(() -> StatisticsService.range(start, start.plusDays(366))
    );
  }
}
