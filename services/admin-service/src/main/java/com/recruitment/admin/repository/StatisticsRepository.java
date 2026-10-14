package com.recruitment.admin.repository;

import com.recruitment.admin.model.DailyStatistic;
import com.recruitment.admin.model.StatEvent;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class StatisticsRepository {
  private final JdbcTemplate db;

  public StatisticsRepository(JdbcTemplate db) {
    this.db = db;
  }

  public void quarantine(String topic, int partition, long offset) {
    db.update("INSERT INTO admin.rejected_events(topic,partition_id,offset_id,error_code) VALUES(?,?,?,'INVALID_EVENT') ON CONFLICT DO NOTHING",
        topic, partition, offset);
  }

  public int insertEvent(StatEvent event, String topic, String payload) {
    return db.update("INSERT INTO admin.stat_events(event_id,topic,entity_id,metric,occurred_at,payload_json) VALUES(?,?,?,?,?,CAST(? AS jsonb)) ON CONFLICT DO NOTHING",
        event.id(), topic, event.entity(), event.metric(), Timestamp.from(event.time()), payload);
  }

  public void markAffectedDatesDirty(UUID entity, String metric) {
    db.update("""
        INSERT INTO admin.dirty_stat_dates(stat_date)
        SELECT DISTINCT (occurred_at AT TIME ZONE 'UTC')::date FROM admin.stat_events WHERE entity_id=? AND metric=?
        ON CONFLICT DO NOTHING
        """, entity, metric);
  }

  public List<LocalDate> lockDirtyDates() {
    return db.query("SELECT stat_date FROM admin.dirty_stat_dates WHERE stat_date < (now() AT TIME ZONE 'UTC')::date ORDER BY stat_date FOR UPDATE SKIP LOCKED LIMIT 365",
        (row, index) -> row.getDate("stat_date").toLocalDate());
  }

  public void rebuildDay(LocalDate date) {
    db.update("DELETE FROM admin.daily_stats WHERE stat_date=?", date);
    db.update("""
        INSERT INTO admin.daily_stats(stat_date,metric,value)
        SELECT ?,metric,count(*) FROM (
          SELECT entity_id,metric,min(occurred_at) AS first_at FROM admin.stat_events
          WHERE metric IS NOT NULL GROUP BY entity_id,metric
        ) firsts WHERE (first_at AT TIME ZONE 'UTC')::date=? GROUP BY metric
        """, date, date);
    db.update("DELETE FROM admin.dirty_stat_dates WHERE stat_date=?", date);
  }

  public List<DailyStatistic> daily(LocalDate from, LocalDate to) {
    return db.query("SELECT stat_date,metric,value FROM admin.daily_stats WHERE stat_date BETWEEN ? AND ? ORDER BY stat_date,metric",
        (row, index) -> new DailyStatistic(row.getDate("stat_date").toLocalDate(), row.getString("metric"), row.getLong("value")), from, to);
  }

  public Map<String, Long> funnel(LocalDate from, LocalDate to) {
    var rows = db.queryForList("""
        WITH cohort AS (
         SELECT entity_id,min(occurred_at) first_at FROM admin.stat_events WHERE metric='APPLIED' GROUP BY entity_id
        ) SELECT e.metric,count(DISTINCT e.entity_id) AS value
        FROM admin.stat_events e JOIN cohort c ON c.entity_id=e.entity_id
        WHERE c.first_at>=? AND c.first_at<? AND e.occurred_at<? AND e.metric IN ('APPLIED','INTERVIEW','OFFER','HIRED')
        GROUP BY e.metric
        """, Timestamp.from(from.atStartOfDay().toInstant(ZoneOffset.UTC)),
        Timestamp.from(to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)),
        Timestamp.from(to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)));
    Map<String, Long> counts = new LinkedHashMap<>();
    for (String metric : List.of("APPLIED", "INTERVIEW", "OFFER", "HIRED")) counts.put(metric, 0L);
    for (var row : rows) counts.put((String) row.get("metric"), ((Number) row.get("value")).longValue());
    return counts;
  }
}
