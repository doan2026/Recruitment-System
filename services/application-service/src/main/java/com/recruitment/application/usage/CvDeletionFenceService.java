package com.recruitment.application.usage;

import com.recruitment.application.api.BusinessException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CvDeletionFenceService {
    private static final long MAX_SAFE_JSON_INTEGER =
        9_007_199_254_740_991L;
    private static final String OPEN = "OPEN";
    private static final String DELETE_FENCED = "DELETE_FENCED";

    private final JdbcTemplate jdbc;

    public CvDeletionFenceService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public CvDeletionFenceResponse acquire(CvDeletionFenceRequest request) {
        validate(request);
        createOpenGate(request.candidateId(), request.cvId());
        GateRow gate = lockGate(request.cvId());
        requireOwner(gate.candidateId(), request.candidateId());

        if (DELETE_FENCED.equals(gate.state())) {
            if (
                request.deletionRequestId().equals(
                    gate.deletionRequestId()
                ) && gate.fencedAt() != null
            ) {
                return fenced(request, gate.fencedAt());
            }
            throw fenceConflict();
        }
        if (!OPEN.equals(gate.state())) {
            throw invalidState();
        }

        UsageRow usage = findUsage(request.cvId());
        if (usage != null) {
            requireOwner(usage.candidateId(), request.candidateId());
            if (
                usage.firstUsedAt() == null ||
                usage.applicationCount() < 1 ||
                usage.applicationCount() > MAX_SAFE_JSON_INTEGER
            ) {
                throw invalidState();
            }
            return new CvDeletionFenceResponse(
                request.candidateId(),
                request.cvId(),
                request.deletionRequestId(),
                CvDeletionFenceDisposition.USED,
                null,
                usage.firstUsedAt(),
                usage.applicationCount()
            );
        }

        Instant fencedAt;
        try {
            List<Instant> timestamps = jdbc.query(
                """
                UPDATE application.cv_submission_gates
                SET state = 'DELETE_FENCED',
                    deletion_request_id = ?,
                    fenced_at = clock_timestamp()
                WHERE cv_id = ?
                  AND state = 'OPEN'
                RETURNING fenced_at
                """,
                (result, rowNumber) ->
                    result.getTimestamp("fenced_at").toInstant(),
                request.deletionRequestId(),
                request.cvId()
            );
            if (timestamps.size() != 1) throw invalidState();
            fencedAt = timestamps.getFirst();
        } catch (DataIntegrityViolationException exception) {
            throw fenceConflict();
        }
        return fenced(request, fencedAt);
    }

    private void validate(CvDeletionFenceRequest request) {
        if (
            request == null ||
            !isUuidV4(request.candidateId()) ||
            !isUuidV4(request.cvId()) ||
            !isUuidV4(request.deletionRequestId())
        ) {
            throw new BusinessException(
                "INVALID_CV_DELETION_FENCE_REQUEST",
                "candidateId, cvId and deletionRequestId must be UUIDv4 values",
                HttpStatus.BAD_REQUEST
            );
        }
    }

    private void createOpenGate(UUID candidateId, UUID cvId) {
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
    }

    private GateRow lockGate(UUID cvId) {
        List<GateRow> rows = jdbc.query(
            """
            SELECT candidate_id,
                   state,
                   deletion_request_id,
                   fenced_at
            FROM application.cv_submission_gates
            WHERE cv_id = ?
            FOR UPDATE
            """,
            this::mapGate,
            cvId
        );
        if (rows.size() != 1) throw invalidState();
        return rows.getFirst();
    }

    private UsageRow findUsage(UUID cvId) {
        List<UsageRow> rows = jdbc.query(
            """
            SELECT candidate_id, first_used_at, application_count
            FROM application.application_cv_usage
            WHERE cv_id = ?
            """,
            this::mapUsage,
            cvId
        );
        if (rows.size() > 1) throw invalidState();
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private void requireOwner(UUID actual, UUID requested) {
        if (!requested.equals(actual)) {
            throw new BusinessException(
                "CV_USAGE_OWNER_MISMATCH",
                "CV usage ownership is inconsistent",
                HttpStatus.CONFLICT
            );
        }
    }

    private CvDeletionFenceResponse fenced(
        CvDeletionFenceRequest request,
        Instant fencedAt
    ) {
        return new CvDeletionFenceResponse(
            request.candidateId(),
            request.cvId(),
            request.deletionRequestId(),
            CvDeletionFenceDisposition.FENCED,
            fencedAt,
            null,
            0
        );
    }

    private BusinessException fenceConflict() {
        return new BusinessException(
            "CV_DELETION_FENCE_CONFLICT",
            "The CV already has a different deletion fence",
            HttpStatus.CONFLICT
        );
    }

    private BusinessException invalidState() {
        return new BusinessException(
            "CV_DELETION_FENCE_INVALID_STATE",
            "CV deletion fence state is invalid",
            HttpStatus.INTERNAL_SERVER_ERROR
        );
    }

    private boolean isUuidV4(UUID value) {
        return value != null && value.version() == 4 && value.variant() == 2;
    }

    private GateRow mapGate(ResultSet result, int rowNumber)
        throws SQLException {
        var fencedAt = result.getTimestamp("fenced_at");
        return new GateRow(
            result.getObject("candidate_id", UUID.class),
            result.getString("state"),
            result.getObject("deletion_request_id", UUID.class),
            fencedAt == null ? null : fencedAt.toInstant()
        );
    }

    private UsageRow mapUsage(ResultSet result, int rowNumber)
        throws SQLException {
        var firstUsedAt = result.getTimestamp("first_used_at");
        return new UsageRow(
            result.getObject("candidate_id", UUID.class),
            firstUsedAt == null ? null : firstUsedAt.toInstant(),
            result.getLong("application_count")
        );
    }

    private record GateRow(
        UUID candidateId,
        String state,
        UUID deletionRequestId,
        Instant fencedAt
    ) {}

    private record UsageRow(
        UUID candidateId,
        Instant firstUsedAt,
        long applicationCount
    ) {}
}
