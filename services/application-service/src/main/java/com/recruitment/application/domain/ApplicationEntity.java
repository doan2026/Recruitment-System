package com.recruitment.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "applications")
public class ApplicationEntity {
    @Id
    private UUID id;

    @Column(name = "job_id", nullable = false)
    private UUID jobId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "candidate_id", nullable = false)
    private UUID candidateId;

    @Column(name = "recruiter_id", nullable = false)
    private UUID recruiterId;

    @Column(name = "cv_id", nullable = false)
    private UUID cvId;

    @Column(name = "job_title", nullable = false, length = 200)
    private String jobTitle;

    @Column(name = "cover_letter", length = 2000)
    private String coverLetter;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ApplicationStatus status;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ApplicationSource source;

    @Column(name = "match_score", precision = 5, scale = 2)
    private BigDecimal matchScore;

    @Column(name = "applied_at", nullable = false)
    private Instant appliedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "profile_skill_snapshot_schema_version")
    private Integer profileSkillSnapshotSchemaVersion;

    @Column(name = "profile_aggregate_version")
    private Long profileAggregateVersion;

    @Column(name = "profile_skill_snapshot_expected_count")
    private Integer profileSkillSnapshotExpectedCount;

    @Version
    @Column(nullable = false)
    private long version;

    protected ApplicationEntity() {}

    public static ApplicationEntity applied(
        UUID id,
        UUID jobId,
        UUID companyId,
        UUID candidateId,
        UUID recruiterId,
        UUID cvId,
        String jobTitle,
        String coverLetter,
        ApplicationSource source,
        Instant now
    ) {
        return applied(
            id,
            jobId,
            companyId,
            candidateId,
            recruiterId,
            cvId,
            jobTitle,
            coverLetter,
            source,
            null,
            null,
            null,
            now
        );
    }

    public static ApplicationEntity applied(
        UUID id,
        UUID jobId,
        UUID companyId,
        UUID candidateId,
        UUID recruiterId,
        UUID cvId,
        String jobTitle,
        String coverLetter,
        ApplicationSource source,
        Integer profileSkillSnapshotSchemaVersion,
        Long profileAggregateVersion,
        Integer profileSkillSnapshotExpectedCount,
        Instant now
    ) {
        ApplicationEntity application = new ApplicationEntity();
        application.id = id;
        application.jobId = jobId;
        application.companyId = companyId;
        application.candidateId = candidateId;
        application.recruiterId = recruiterId;
        application.cvId = cvId;
        application.jobTitle = jobTitle;
        application.coverLetter = coverLetter;
        application.status = ApplicationStatus.APPLIED;
        application.source = source;
        application.profileSkillSnapshotSchemaVersion =
            profileSkillSnapshotSchemaVersion;
        application.profileAggregateVersion = profileAggregateVersion;
        application.profileSkillSnapshotExpectedCount =
            profileSkillSnapshotExpectedCount;
        application.appliedAt = now;
        application.updatedAt = now;
        return application;
    }

    @PrePersist
    void prePersist() {
        if (appliedAt == null) appliedAt = Instant.now();
        if (updatedAt == null) updatedAt = appliedAt;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getJobId() { return jobId; }
    public UUID getCompanyId() { return companyId; }
    public UUID getCandidateId() { return candidateId; }
    public UUID getRecruiterId() { return recruiterId; }
    public UUID getCvId() { return cvId; }
    public String getJobTitle() { return jobTitle; }
    public String getCoverLetter() { return coverLetter; }
    public ApplicationStatus getStatus() { return status; }
    public ApplicationSource getSource() { return source; }
    public BigDecimal getMatchScore() { return matchScore; }
    public Instant getAppliedAt() { return appliedAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Integer getProfileSkillSnapshotSchemaVersion() {
        return profileSkillSnapshotSchemaVersion;
    }
    public Long getProfileAggregateVersion() {
        return profileAggregateVersion;
    }
    public Integer getProfileSkillSnapshotExpectedCount() {
        return profileSkillSnapshotExpectedCount;
    }
    public long getVersion() { return version; }
}
