package com.recruitment.application.submission;

import java.util.List;
import java.util.Objects;

public record ProfileSkillSnapshot(
    int schemaVersion,
    long profileAggregateVersion,
    List<String> skills
) {
    public ProfileSkillSnapshot {
        skills = List.copyOf(Objects.requireNonNull(skills, "skills"));
    }
}
