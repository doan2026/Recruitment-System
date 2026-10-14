package com.recruitment.admin.infrastructure.kafka;

import com.recruitment.admin.service.StatisticsService;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class StatisticsEventConsumer {
  private final StatisticsService statistics;

  public StatisticsEventConsumer(StatisticsService statistics) {
    this.statistics = statistics;
  }

  @KafkaListener(topics = {"job-events", "application-events"})
  public void consume(ConsumerRecord<String, String> record) {
    statistics.consume(record);
  }
}
