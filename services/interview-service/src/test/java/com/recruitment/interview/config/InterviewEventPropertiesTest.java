package com.recruitment.interview.config;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class InterviewEventPropertiesTest {
    @Test
    void acceptsSafeDefaults() {
        new InterviewEventProperties().validate();
    }

    @Test
    void rejectsInvalidTopicRetryAndLeaseBounds() {
        InterviewEventProperties invalidTopic =
            new InterviewEventProperties();
        invalidTopic.setTopic("../interview events");
        assertThatThrownBy(invalidTopic::validate)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("valid Kafka topic");

        InterviewEventProperties uppercaseTopic =
            new InterviewEventProperties();
        uppercaseTopic.setTopic("Interview-Events");
        assertThatThrownBy(uppercaseTopic::validate)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("valid Kafka topic");

        InterviewEventProperties invalidRetry =
            new InterviewEventProperties();
        invalidRetry.setRetryBaseMs(2_000);
        invalidRetry.setRetryMaxMs(1_000);
        assertThatThrownBy(invalidRetry::validate)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("retry-max-ms");

        InterviewEventProperties invalidLease =
            new InterviewEventProperties();
        invalidLease.setLeaseMs(10_000);
        invalidLease.setPublishTimeoutMs(5_000);
        assertThatThrownBy(invalidLease::validate)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("four times");
    }
}
