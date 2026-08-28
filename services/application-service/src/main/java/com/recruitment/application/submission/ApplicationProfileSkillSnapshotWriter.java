package com.recruitment.application.submission;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class ApplicationProfileSkillSnapshotWriter {
    private static final int MAX_SKILLS = 100;
    private static final int BATCH_SIZE = 100;

    private final JdbcTemplate jdbc;

    public ApplicationProfileSkillSnapshotWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void save(UUID applicationId, List<String> skills) {
        if (skills.size() > MAX_SKILLS) {
            throw new IllegalArgumentException(
                "Profile skill snapshots cannot exceed 100 skills"
            );
        }
        if (skills.isEmpty()) return;
        jdbc.batchUpdate(
            """
            INSERT INTO application.application_profile_skill_snapshots (
                application_id,
                skill_name
            ) VALUES (?, ?)
            """,
            skills,
            BATCH_SIZE,
            (statement, skill) -> {
                statement.setObject(1, applicationId);
                statement.setString(2, skill);
            }
        );
    }
}
