package com.recruitment.admin.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.admin.dto.common.ApiResponse;
import com.recruitment.admin.dto.statistics.DailyStatisticResponse;
import com.recruitment.admin.dto.statistics.FunnelStageResponse;
import com.recruitment.admin.dto.statistics.StatisticsOverviewResponse;
import com.recruitment.admin.exception.AdminFailure;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import com.recruitment.admin.infrastructure.kafka.StatEventParser;
import com.recruitment.admin.model.DailyStatistic;
import com.recruitment.admin.model.StatEvent;
import com.recruitment.admin.repository.StatisticsRepository;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StatisticsService {
  private final StatisticsRepository repository;
  private final ObjectMapper mapper;
  private final ServiceGateway gateway;

  public StatisticsService(StatisticsRepository repository, ObjectMapper mapper, ServiceGateway gateway) {
    this.repository = repository;
    this.mapper = mapper;
    this.gateway = gateway;
  }

  @Transactional
  public void consume(ConsumerRecord<String, String> record) {
    StatEvent event;
    try {
      if (record.value() == null || record.value().length() > 1_048_576) throw new IllegalArgumentException();
      event = StatEventParser.parse(record.topic(), mapper.readTree(record.value()));
    } catch (Exception invalid) {
      // Malformed records are durably quarantined; database failures must propagate to Kafka.
      repository.quarantine(record.topic(), record.partition(), record.offset());
      return;
    }
    int inserted = repository.insertEvent(event, record.topic(), record.value());
    if (inserted == 1 && event.metric() != null) repository.markAffectedDatesDirty(event.entity(), event.metric());
  }

  @Transactional
  public void aggregate() {
    // The transaction retains SKIP LOCKED row locks across the complete day rebuild.
    for (LocalDate date : repository.lockDirtyDates()) repository.rebuildDay(date);
  }

  public static void range(LocalDate from, LocalDate to) {
    if (from == null || to == null || to.isBefore(from) || ChronoUnit.DAYS.between(from, to) > 366) {
      throw new AdminFailure(400, "INVALID_DATE_RANGE");
    }
  }

  public List<DailyStatistic> daily(LocalDate from, LocalDate to) {
    range(from, to);
    return repository.daily(from, to);
  }

  public ApiResponse<StatisticsOverviewResponse> overview(Jwt actor, LocalDate from, LocalDate to) {
    gateway.requireCurrentAdmin(actor);
    var rows = daily(from, to);
    var totals = new TreeMap<String, Long>();
    for (var row : rows) totals.merge(row.metric(), row.value(), Long::sum);
    return new ApiResponse<>(new StatisticsOverviewResponse(
        rows.stream().map(DailyStatisticResponse::from).toList(), totals, List.of("NEW_USERS", "NEW_COMPANIES")),
        Map.of("timezone", "UTC", "aggregatedThrough", LocalDate.now(ZoneOffset.UTC).minusDays(1), "source", "DAILY_STATS"));
  }

  public ApiResponse<List<FunnelStageResponse>> funnel(Jwt actor, LocalDate from, LocalDate to) {
    gateway.requireCurrentAdmin(actor);
    range(from, to);
    Map<String, Long> counts = repository.funnel(from, to);
    long applied = counts.get("APPLIED");
    var stages = counts.entrySet().stream().map(entry -> new FunnelStageResponse(entry.getKey(), entry.getValue(),
        applied == 0 ? 0.0 : 100.0 * entry.getValue() / applied)).toList();
    return new ApiResponse<>(stages, Map.of("cohort", "FIRST_APPLIED_IN_RANGE", "asOf", to));
  }
}
