package com.recruitment.interview.query;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.domain.InterviewStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class InterviewQueryModels {
    private InterviewQueryModels() {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Item(
        UUID id,
        UUID applicationId,
        UUID companyId,
        UUID jobId,
        UUID candidateId,
        UUID interviewerId,
        UUID scheduledBy,
        int roundNumber,
        int scheduleRevision,
        Instant scheduledStart,
        Instant scheduledEnd,
        String timeZone,
        int durationMinutes,
        InterviewMode mode,
        String location,
        String notes,
        InterviewStatus status,
        Instant createdAt,
        Instant updatedAt,
        long version
    ) {}

    public record Page(
        List<Item> items,
        String nextCursor,
        Instant asOf
    ) {
        public Page {
            items = List.copyOf(items);
        }
    }

    public record Slot(Instant start, Instant end) {}

    public record Availability(
        UUID applicationId,
        UUID interviewerId,
        Instant from,
        Instant to,
        String timeZone,
        int durationMinutes,
        int stepMinutes,
        List<Slot> slots,
        String nextCursor,
        Instant asOf
    ) {
        public Availability {
            slots = List.copyOf(slots);
        }
    }
}
