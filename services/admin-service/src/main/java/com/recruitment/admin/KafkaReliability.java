package com.recruitment.admin;

import org.springframework.context.annotation.*;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

@Configuration
class KafkaReliability {

  @Bean
  DefaultErrorHandler kafkaErrorHandler() {
    // Malformed events are quarantined by the listener. Database outages must never skip a record.
    return new DefaultErrorHandler(
      new FixedBackOff(5000L, FixedBackOff.UNLIMITED_ATTEMPTS)
    );
  }
}
