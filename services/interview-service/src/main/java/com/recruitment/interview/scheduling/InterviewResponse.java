package com.recruitment.interview.scheduling;

import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.domain.InterviewStatus;
import java.time.Instant;
import java.util.UUID;

public record InterviewResponse(
    UUID id,
    UUID applicationId,
    long applicationVersion,
    UUID jobId,
    UUID companyId,
    UUID candidateId,
    UUID interviewerId,
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
    long version
) {
    static InterviewResponse from(InterviewEntity interview) {
        return new InterviewResponse(
            interview.getId(),
            interview.getApplicationId(),
            interview.getApplicationVersion(),
            interview.getJobId(),
            interview.getCompanyId(),
            interview.getCandidateId(),
            interview.getInterviewerId(),
            interview.getRoundNumber(),
            interview.getScheduleRevision(),
            interview.getScheduledStartAt(),
            interview.getScheduledEndAt(),
            interview.getTimeZone(),
            interview.getDurationMinutes(),
            interview.getMode(),
            interview.getLocation(),
            interview.getNotes(),
            interview.getStatus(),
            interview.getCreatedAt(),
            interview.getVersion()
        );
    }
}
