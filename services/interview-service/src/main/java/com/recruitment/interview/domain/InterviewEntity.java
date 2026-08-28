package com.recruitment.interview.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "interviews")
public class InterviewEntity {
    @Id
    private UUID id;

    @Column(name = "application_id", nullable = false)
    private UUID applicationId;

    @Column(name = "application_version", nullable = false)
    private long applicationVersion;

    @Column(name = "application_status_at_schedule", nullable = false)
    private String applicationStatusAtSchedule;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "job_id", nullable = false)
    private UUID jobId;

    @Column(name = "candidate_id", nullable = false)
    private UUID candidateId;

    @Column(name = "interviewer_id", nullable = false)
    private UUID interviewerId;

    @Column(name = "scheduled_by", nullable = false)
    private UUID scheduledBy;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @Column(name = "request_hash", nullable = false, length = 64)
    private String requestHash;

    @Column(name = "round_number", nullable = false)
    private short roundNumber;

    @Column(name = "schedule_revision", nullable = false)
    private int scheduleRevision;

    @Column(name = "scheduled_start_at", nullable = false)
    private Instant scheduledStartAt;

    @Column(name = "scheduled_end_at", nullable = false)
    private Instant scheduledEndAt;

    @Column(name = "time_zone", nullable = false, length = 100)
    private String timeZone;

    @Column(name = "duration_minutes", nullable = false)
    private short durationMinutes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private InterviewMode mode;

    @Column(length = 500)
    private String location;

    @Column(length = 2000)
    private String notes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private InterviewStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected InterviewEntity() {}

    public static InterviewEntity schedule(
        UUID id,
        UUID applicationId,
        long applicationVersion,
        String applicationStatus,
        UUID companyId,
        UUID jobId,
        UUID candidateId,
        UUID interviewerId,
        UUID requestId,
        String requestHash,
        int roundNumber,
        Instant scheduledStartAt,
        Instant scheduledEndAt,
        String timeZone,
        int durationMinutes,
        InterviewMode mode,
        String location,
        String notes,
        Instant now
    ) {
        InterviewEntity interview = new InterviewEntity();
        interview.id = id;
        interview.applicationId = applicationId;
        interview.applicationVersion = applicationVersion;
        interview.applicationStatusAtSchedule = applicationStatus;
        interview.companyId = companyId;
        interview.jobId = jobId;
        interview.candidateId = candidateId;
        interview.interviewerId = interviewerId;
        interview.scheduledBy = interviewerId;
        interview.requestId = requestId;
        interview.requestHash = requestHash;
        interview.roundNumber = (short) roundNumber;
        interview.scheduleRevision = 1;
        interview.scheduledStartAt = scheduledStartAt;
        interview.scheduledEndAt = scheduledEndAt;
        interview.timeZone = timeZone;
        interview.durationMinutes = (short) durationMinutes;
        interview.mode = mode;
        interview.location = location;
        interview.notes = notes;
        interview.status = InterviewStatus.SCHEDULED;
        interview.createdAt = now;
        interview.updatedAt = now;
        return interview;
    }

    public UUID getId() { return id; }
    public UUID getApplicationId() { return applicationId; }
    public long getApplicationVersion() { return applicationVersion; }
    public String getApplicationStatusAtSchedule() {
        return applicationStatusAtSchedule;
    }
    public UUID getCompanyId() { return companyId; }
    public UUID getJobId() { return jobId; }
    public UUID getCandidateId() { return candidateId; }
    public UUID getInterviewerId() { return interviewerId; }
    public UUID getScheduledBy() { return scheduledBy; }
    public UUID getRequestId() { return requestId; }
    public String getRequestHash() { return requestHash; }
    public int getRoundNumber() { return roundNumber; }
    public int getScheduleRevision() { return scheduleRevision; }
    public Instant getScheduledStartAt() { return scheduledStartAt; }
    public Instant getScheduledEndAt() { return scheduledEndAt; }
    public String getTimeZone() { return timeZone; }
    public int getDurationMinutes() { return durationMinutes; }
    public InterviewMode getMode() { return mode; }
    public String getLocation() { return location; }
    public String getNotes() { return notes; }
    public InterviewStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public long getVersion() { return version; }
}
