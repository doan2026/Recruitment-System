package com.recruitment.application.submission;

import com.recruitment.application.api.BusinessException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CvSubmissionGateService {
    private static final String OPEN = "OPEN";

    private final JdbcTemplate jdbc;

    public CvSubmissionGateService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void lockForSubmission(UUID candidateId, UUID cvId) {
        jdbc.update(
            """
            INSERT INTO application.cv_submission_gates (
                cv_id,
                candidate_id,
                state
            ) VALUES (?, ?, 'OPEN')
            ON CONFLICT (cv_id) DO NOTHING
            """,
            cvId,
            candidateId
        );

        List<GateRow> rows = jdbc.query(
            """
            SELECT candidate_id, state
            FROM application.cv_submission_gates
            WHERE cv_id = ?
            FOR UPDATE
            """,
            this::mapGate,
            cvId
        );
        if (
            rows.size() != 1 ||
            !candidateId.equals(rows.getFirst().candidateId()) ||
            !OPEN.equals(rows.getFirst().state())
        ) {
            throw cvNotAvailable();
        }
    }

    private GateRow mapGate(ResultSet result, int rowNumber)
        throws SQLException {
        return new GateRow(
            result.getObject("candidate_id", UUID.class),
            result.getString("state")
        );
    }

    private BusinessException cvNotAvailable() {
        return new BusinessException(
            "CV_NOT_AVAILABLE",
            "The selected CV does not exist or is not available to this candidate",
            HttpStatus.BAD_REQUEST
        );
    }

    private record GateRow(UUID candidateId, String state) {}
}
