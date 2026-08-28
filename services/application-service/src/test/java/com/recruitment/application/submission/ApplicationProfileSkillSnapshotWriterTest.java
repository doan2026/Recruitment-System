package com.recruitment.application.submission;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ApplicationProfileSkillSnapshotWriterTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ApplicationProfileSkillSnapshotWriter writer =
        new ApplicationProfileSkillSnapshotWriter(jdbc);

    @Test
    void emptySnapshotNeedsNoChildInsert() {
        writer.save(UUID.randomUUID(), List.of());

        verifyNoInteractions(jdbc);
    }

    @Test
    void rejectsSnapshotsAboveTheDatabaseLimit() {
        assertThatThrownBy(() -> writer.save(
            UUID.randomUUID(),
            Collections.nCopies(101, "Skill")
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("100");

        verifyNoInteractions(jdbc);
    }
}
