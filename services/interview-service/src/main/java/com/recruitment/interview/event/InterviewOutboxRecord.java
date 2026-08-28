package com.recruitment.interview.event;

import java.util.UUID;

record InterviewOutboxRecord(
    UUID eventId,
    UUID eventKey,
    String topic,
    String payload,
    int attempts,
    long leaseFence
) {}
