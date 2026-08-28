package com.recruitment.application.usage;

import com.recruitment.application.api.BusinessException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CvUsageLookupService {
    private static final long MAX_SAFE_JSON_INTEGER =
        9_007_199_254_740_991L;

    private final JdbcTemplate jdbc;

    public CvUsageLookupService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public CvUsageLookupResponse lookup(CvUsageLookupRequest request) {
        if (
            !isUuidV4(request.candidateId()) ||
            !isUuidV4(request.cvId())
        ) {
            throw new BusinessException(
                "INVALID_CV_USAGE_REQUEST",
                "candidateId and cvId must be UUIDv4 values",
                HttpStatus.BAD_REQUEST
            );
        }

        List<UsageRow> rows = jdbc.query(
            """
            SELECT candidate_id, first_used_at, application_count
            FROM application.application_cv_usage
            WHERE cv_id = ?
            """,
            this::mapRow,
            request.cvId()
        );
        if (rows.isEmpty()) {
            return new CvUsageLookupResponse(
                request.candidateId(),
                request.cvId(),
                false,
                null,
                0
            );
        }

        UsageRow usage = rows.getFirst();
        if (!usage.candidateId().equals(request.candidateId())) {
            throw new BusinessException(
                "CV_USAGE_OWNER_MISMATCH",
                "CV usage ownership is inconsistent",
                HttpStatus.CONFLICT
            );
        }
        if (
            usage.firstUsedAt() == null ||
            usage.applicationCount() < 1 ||
            usage.applicationCount() > MAX_SAFE_JSON_INTEGER
        ) {
            throw new BusinessException(
                "CV_USAGE_INVALID_STATE",
                "CV usage state is invalid",
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
        return new CvUsageLookupResponse(
            request.candidateId(),
            request.cvId(),
            true,
            usage.firstUsedAt(),
            usage.applicationCount()
        );
    }
    private boolean isUuidV4(UUID value) {
        return value != null && value.version() == 4 && value.variant() == 2;
    }


    private UsageRow mapRow(ResultSet result, int rowNumber)
        throws SQLException {
        return new UsageRow(
            result.getObject("candidate_id", UUID.class),
            result.getTimestamp("first_used_at").toInstant(),
            result.getLong("application_count")
        );
    }

    private record UsageRow(
        UUID candidateId,
        Instant firstUsedAt,
        long applicationCount
    ) {}
}
