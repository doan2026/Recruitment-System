package com.recruitment.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class StatisticsService {

  final JdbcTemplate db;
  private final ObjectMapper mapper;

  StatisticsService(JdbcTemplate db, ObjectMapper mapper) {
    this.db = db;
    this.mapper = mapper;
  }

  @KafkaListener(topics = { "job-events", "application-events" })
  @Transactional
  public void consume(ConsumerRecord<String, String> record) {
    StatEventParser.Event event;
    try {
      if (
        record.value() == null || record.value().length() > 1_048_576
      ) throw new IllegalArgumentException();
      event = StatEventParser.parse(
        record.topic(),
        mapper.readTree(record.value())
      );
    } catch (Exception e) {
      // Poison messages are durably quarantined by broker coordinates, without logging PII.
      db.update(
        "INSERT INTO admin.rejected_events(topic,partition_id,offset_id,error_code) VALUES(?,?,?,'INVALID_EVENT') ON CONFLICT DO NOTHING",
        record.topic(),
        record.partition(),
        record.offset()
      );
      return;
    }
    int inserted = db.update(
      "INSERT INTO admin.stat_events(event_id,topic,entity_id,metric,occurred_at,payload_json) VALUES(?,?,?,?,?,CAST(? AS jsonb)) ON CONFLICT DO NOTHING",
      event.id(),
      record.topic(),
      event.entity(),
      event.metric(),
      Timestamp.from(event.time()),
      record.value()
    );
    if (inserted == 1 && event.metric() != null) {
      // Recompute every affected date, including the previous earliest occurrence on late delivery.
      db.update(
        """
        INSERT INTO admin.dirty_stat_dates(stat_date)
        SELECT DISTINCT (occurred_at AT TIME ZONE 'UTC')::date FROM admin.stat_events WHERE entity_id=? AND metric=?
        ON CONFLICT DO NOTHING
        """,
        event.entity(),
        event.metric()
      );
    }
  }

  @Scheduled(cron = "0 15 0 * * *", zone = "UTC")
  @Transactional
  public void aggregate() {
    // SKIP LOCKED allows replicas to rebuild disjoint dates. Late events re-dirty their dates.
    var dates = db.queryForList(
      "SELECT stat_date FROM admin.dirty_stat_dates WHERE stat_date < (now() AT TIME ZONE 'UTC')::date ORDER BY stat_date FOR UPDATE SKIP LOCKED LIMIT 365"
    );
    for (var row : dates) {
      var date = ((java.sql.Date) row.get("stat_date")).toLocalDate();
      db.update("DELETE FROM admin.daily_stats WHERE stat_date=?", date);
      db.update(
        """
        INSERT INTO admin.daily_stats(stat_date,metric,value)
        SELECT ?,metric,count(*) FROM (
          SELECT entity_id,metric,min(occurred_at) AS first_at FROM admin.stat_events
          WHERE metric IS NOT NULL GROUP BY entity_id,metric
        ) firsts WHERE (first_at AT TIME ZONE 'UTC')::date=? GROUP BY metric
        """,
        date,
        date
      );
      db.update("DELETE FROM admin.dirty_stat_dates WHERE stat_date=?", date);
    }
  }

  static void range(LocalDate from, LocalDate to) {
    if (
      from == null ||
      to == null ||
      to.isBefore(from) ||
      java.time.temporal.ChronoUnit.DAYS.between(from, to) > 366
    ) throw new AdminFailure(400, "INVALID_DATE_RANGE");
  }

  List<Map<String, Object>> daily(LocalDate from, LocalDate to) {
    range(from, to);
    return db.queryForList(
      "SELECT stat_date,metric,value FROM admin.daily_stats WHERE stat_date BETWEEN ? AND ? ORDER BY stat_date,metric",
      from,
      to
    );
  }

  Object overview(LocalDate from, LocalDate to) {
    var rows = daily(from, to);
    var totals = new TreeMap<String, Long>();
    for (var row : rows) totals.merge(
      (String) row.get("metric"),
      ((Number) row.get("value")).longValue(),
      Long::sum
    );
    return Map.of(
      "data",
      Map.of(
        "daily",
        rows,
        "totals",
        totals,
        "unavailableMetrics",
        List.of("NEW_USERS", "NEW_COMPANIES")
      ),
      "meta",
      Map.of(
        "timezone",
        "UTC",
        "aggregatedThrough",
        LocalDate.now(ZoneOffset.UTC).minusDays(1),
        "source",
        "DAILY_STATS"
      )
    );
  }

  Object funnel(LocalDate from, LocalDate to) {
    range(from, to);
    // Cohort funnel: denominator is applications first applied in the selected period.
    var rows = db.queryForList(
      """
      WITH cohort AS (
       SELECT entity_id,min(occurred_at) first_at FROM admin.stat_events WHERE metric='APPLIED' GROUP BY entity_id
      ) SELECT e.metric,count(DISTINCT e.entity_id) AS value
      FROM admin.stat_events e JOIN cohort c ON c.entity_id=e.entity_id
      WHERE c.first_at>=? AND c.first_at<? AND e.occurred_at<? AND e.metric IN ('APPLIED','INTERVIEW','OFFER','HIRED')
      GROUP BY e.metric
      """,
      Timestamp.from(from.atStartOfDay().toInstant(ZoneOffset.UTC)),
      Timestamp.from(to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)),
      Timestamp.from(to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC))
    );
    Map<String, Long> counts = new LinkedHashMap<>();
    for (String metric : List.of(
      "APPLIED",
      "INTERVIEW",
      "OFFER",
      "HIRED"
    )) counts.put(metric, 0L);
    for (var row : rows) counts.put(
      (String) row.get("metric"),
      ((Number) row.get("value")).longValue()
    );
    long applied = counts.get("APPLIED");
    var stages = counts
      .entrySet()
      .stream()
      .map(e ->
        Map.of(
          "stage",
          e.getKey(),
          "count",
          e.getValue(),
          "rate",
          applied == 0 ? 0.0 : (100.0 * e.getValue()) / applied
        )
      )
      .toList();
    return Map.of(
      "data",
      stages,
      "meta",
      Map.of("cohort", "FIRST_APPLIED_IN_RANGE", "asOf", to)
    );
  }
}
