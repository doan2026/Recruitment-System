package com.recruitment.admin.infrastructure.scheduler;

import com.recruitment.admin.service.StatisticsService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class StatisticsAggregationScheduler {
  private final StatisticsService statistics;

  public StatisticsAggregationScheduler(StatisticsService statistics) {
    this.statistics = statistics;
  }

  @Scheduled(cron = "0 15 0 * * *", zone = "UTC")
  public void aggregate() {
    statistics.aggregate();
  }
}
