package com.recruitment.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "application_history")
public class ApplicationHistoryEntity {
    @Id
    private UUID id;

    @Column(name = "application_id", nullable = false)
    private UUID applicationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", length = 30)
    private ApplicationStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false, length = 30)
    private ApplicationStatus toStatus;

    @Column(name = "changed_by", nullable = false)
    private UUID changedBy;

    @Column(length = 2000)
    private String note;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    protected ApplicationHistoryEntity() {}

    public static ApplicationHistoryEntity initial(
        UUID id,
        UUID applicationId,
        UUID candidateId,
        Instant now
    ) {
        ApplicationHistoryEntity history = new ApplicationHistoryEntity();
        history.id = id;
        history.applicationId = applicationId;
        history.fromStatus = null;
        history.toStatus = ApplicationStatus.APPLIED;
        history.changedBy = candidateId;
        history.changedAt = now;
        return history;
    }
}
