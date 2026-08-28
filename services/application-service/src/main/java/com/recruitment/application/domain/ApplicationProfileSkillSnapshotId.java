package com.recruitment.application.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class ApplicationProfileSkillSnapshotId implements Serializable {
    private UUID applicationId;
    private String normalizedName;

    public ApplicationProfileSkillSnapshotId() {}

    public ApplicationProfileSkillSnapshotId(
        UUID applicationId,
        String normalizedName
    ) {
        this.applicationId = applicationId;
        this.normalizedName = normalizedName;
    }

    public UUID getApplicationId() { return applicationId; }

    public void setApplicationId(UUID applicationId) {
        this.applicationId = applicationId;
    }

    public String getNormalizedName() { return normalizedName; }

    public void setNormalizedName(String normalizedName) {
        this.normalizedName = normalizedName;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof ApplicationProfileSkillSnapshotId that)) {
            return false;
        }
        return Objects.equals(applicationId, that.applicationId) &&
            Objects.equals(normalizedName, that.normalizedName);
    }

    @Override
    public int hashCode() {
        return Objects.hash(applicationId, normalizedName);
    }
}
