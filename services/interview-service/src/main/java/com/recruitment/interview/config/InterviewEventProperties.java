package com.recruitment.interview.config;

import jakarta.annotation.PostConstruct;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "interview-events")
public class InterviewEventProperties {
    private static final String TOPIC_PATTERN = "^[a-z0-9._-]{1,100}$";

    private String topic = "interview-events";
    private boolean publisherEnabled = true;
    private long pollDelayMs = 5_000;
    private long publishInitialDelayMs = 5_000;
    private long leaseMs = 30_000;
    private int batchSize = 100;
    private long retryBaseMs = 1_000;
    private long retryMaxMs = 60_000;
    private long publishTimeoutMs = 5_000;
    private long backlogMaxAgeMs = 900_000;

    @PostConstruct
    public void validate() {
        if (
            topic == null ||
            !topic.matches(TOPIC_PATTERN) ||
            ".".equals(topic) ||
            "..".equals(topic)
        ) {
            throw new IllegalStateException(
                "interview-events.topic must be a valid Kafka topic"
            );
        }
        requireRange("poll-delay-ms", pollDelayMs, 100, 300_000);
        requireRange(
            "publish-initial-delay-ms",
            publishInitialDelayMs,
            0,
            300_000
        );
        requireRange("lease-ms", leaseMs, 1_000, 900_000);
        requireRange("batch-size", batchSize, 1, 1_000);
        requireRange("retry-base-ms", retryBaseMs, 100, 300_000);
        requireRange("retry-max-ms", retryMaxMs, 100, 3_600_000);
        requireRange("publish-timeout-ms", publishTimeoutMs, 500, 30_000);
        requireRange(
            "backlog-max-age-ms",
            backlogMaxAgeMs,
            60_000,
            86_400_000
        );
        if (retryMaxMs < retryBaseMs) {
            throw new IllegalStateException(
                "interview-events.retry-max-ms must be at least retry-base-ms"
            );
        }
        if (leaseMs < publishTimeoutMs * 4) {
            throw new IllegalStateException(
                "interview-events.lease-ms must be at least four times publish-timeout-ms"
            );
        }
    }

    private void requireRange(
        String name,
        long value,
        long minimum,
        long maximum
    ) {
        if (value < minimum || value > maximum) {
            throw new IllegalStateException(
                "interview-events." + name + " is outside the allowed range"
            );
        }
    }

    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public boolean isPublisherEnabled() { return publisherEnabled; }
    public void setPublisherEnabled(boolean publisherEnabled) {
        this.publisherEnabled = publisherEnabled;
    }
    public long getPollDelayMs() { return pollDelayMs; }
    public void setPollDelayMs(long pollDelayMs) {
        this.pollDelayMs = pollDelayMs;
    }
    public long getPublishInitialDelayMs() {
        return publishInitialDelayMs;
    }
    public void setPublishInitialDelayMs(long publishInitialDelayMs) {
        this.publishInitialDelayMs = publishInitialDelayMs;
    }
    public long getLeaseMs() { return leaseMs; }
    public void setLeaseMs(long leaseMs) { this.leaseMs = leaseMs; }
    public int getBatchSize() { return batchSize; }
    public void setBatchSize(int batchSize) { this.batchSize = batchSize; }
    public long getRetryBaseMs() { return retryBaseMs; }
    public void setRetryBaseMs(long retryBaseMs) {
        this.retryBaseMs = retryBaseMs;
    }
    public long getRetryMaxMs() { return retryMaxMs; }
    public void setRetryMaxMs(long retryMaxMs) {
        this.retryMaxMs = retryMaxMs;
    }
    public long getPublishTimeoutMs() { return publishTimeoutMs; }
    public void setPublishTimeoutMs(long publishTimeoutMs) {
        this.publishTimeoutMs = publishTimeoutMs;
    }
    public long getBacklogMaxAgeMs() { return backlogMaxAgeMs; }
    public void setBacklogMaxAgeMs(long backlogMaxAgeMs) {
        this.backlogMaxAgeMs = backlogMaxAgeMs;
    }
}
