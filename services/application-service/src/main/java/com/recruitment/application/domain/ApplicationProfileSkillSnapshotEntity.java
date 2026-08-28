package com.recruitment.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.util.UUID;
import org.hibernate.annotations.Immutable;

@Entity
@Immutable
@IdClass(ApplicationProfileSkillSnapshotId.class)
@Table(name = "application_profile_skill_snapshots")
public class ApplicationProfileSkillSnapshotEntity {
    @Id
    @Column(name = "application_id", nullable = false, updatable = false)
    private UUID applicationId;

    @Column(
        name = "skill_name",
        nullable = false,
        length = 120,
        updatable = false
    )
    private String skillName;

    @Id
    @Column(
        name = "normalized_name",
        nullable = false,
        length = 120,
        insertable = false,
        updatable = false
    )
    private String normalizedName;

    protected ApplicationProfileSkillSnapshotEntity() {}

    public UUID getApplicationId() { return applicationId; }
    public String getSkillName() { return skillName; }
    public String getNormalizedName() { return normalizedName; }
}
